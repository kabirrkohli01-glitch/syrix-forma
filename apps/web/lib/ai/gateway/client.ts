/* One round with a model, across a chain of providers.
 *
 * The contract here is deliberately the same one Vantage's gateway already
 * speaks (`src/syrix/gateway.js`): a mode, a message list, optional streaming,
 * and a reduced event dialect on the way back. Keeping the shape means the
 * shipped form — this chain moved behind a Cloudflare Worker that holds the keys
 * — is a change of transport, not of callers.
 *
 * FAILOVER IS ON REFUSAL, NOT ON DISSATISFACTION. A provider that rate-limits,
 * errors or times out hands the request to the next one. A provider that answers
 * badly does not: retrying a successful call burns the allowance that makes the
 * chain feel unlimited, and produces a different answer each time for reasons
 * nobody can reconstruct.
 */

import { chainFor, isConfigured, type Provider, type Tier } from './providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/* An image handed to the model as a picture rather than described in words.
 *
 * The gateway takes these on a `media` array alongside the messages, which is
 * the shape the SYRIX terminal already sends. A provider that does not
 * understand the field ignores it, so a request carrying media is never worse
 * than the same request without it — see the note in `callProvider`. */
export interface ChatMedia {
  /** `image/png`, `image/jpeg`, `image/webp` or `image/gif`. */
  mime: string;
  /** Base64, no data-URL prefix. */
  data: string;
  /** The filename, so the model can refer to the right one when several are attached. */
  name: string;
}

export interface ChatRequest {
  tier: Tier;
  messages: ChatMessage[];
  /** Images to look at. Only the gateway protocol carries these. */
  media?: ChatMedia[];
  /**
   * True when any part of this request derives from Hub data, even redacted.
   * Restricts the chain to providers that do not retain input. Default true —
   * the safe direction, so forgetting to set it cannot leak.
   */
  carriesHubContext?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called with each token as it arrives. Streams when present. */
  onToken?: (full: string, delta: string) => void;
}

export interface ChatResult {
  text: string;
  /** Which provider actually answered. Shown in the process panel — a silent switch is a debugging trap. */
  provider: string;
  model: string;
  ms: number;
  /** Providers that refused before this one, so the operator can see the chain working. */
  skipped: { provider: string; reason: string }[];
}

/** Raised when every provider in the chain refused. Carries what each said. */
export class ChainExhaustedError extends Error {
  readonly kind = 'chain_exhausted';
  constructor(
    message: string,
    readonly attempts: { provider: string; reason: string }[]
  ) {
    super(message);
    this.name = 'ChainExhaustedError';
  }
}

/** Raised when the caller aborted, so a stop reads as a stop and not as a failure. */
export class StoppedError extends Error {
  readonly stopped = true;
  constructor() {
    super('Stopped.');
    this.name = 'StoppedError';
  }
}

const DEFAULT_TIMEOUT_MS = 90_000;

/* A provider that just rate-limited is skipped for a short while rather than
   retried into the same wall on the next turn. Process-local: a restart clears
   it, which is the right default for something this cheap to rediscover. */
const cooling = new Map<string, number>();
const COOLDOWN_MS = 60_000;

function isCooling(id: string): boolean {
  const until = cooling.get(id);
  if (!until) return false;
  if (Date.now() > until) {
    cooling.delete(id);
    return false;
  }
  return true;
}

function markCooling(id: string, retryAfterSeconds?: number): void {
  const wait = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : COOLDOWN_MS;
  cooling.set(id, Date.now() + Math.min(wait, 10 * 60_000));
}

/** Whether a failure should move the request down the chain, or stop it. */
function shouldFailOver(status: number): boolean {
  /* 429 and 5xx are the provider's problem and the next one may not have it.
     401/403 mean a bad key — also worth moving on, since one misconfigured
     provider must not take down the chain. 400 is our own malformed request and
     will fail identically everywhere, so it stops here. */
  return status === 429 || status === 401 || status === 403 || status >= 500;
}

interface StreamState {
  text: string;
}

/* Providers stream server-sent events carrying OpenAI-shaped deltas. Frames are
   read as they arrive rather than buffered, so a long answer appears as it is
   written instead of after a silence. */
async function readStream(
  response: Response,
  onToken: ((full: string, delta: string) => void) | undefined,
  state: StreamState
): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    /* The last piece is a partial frame; it stays in the buffer until the rest
       arrives. Treating it as complete truncates a token, and on a multi-byte
       character it truncates mid-letter. */
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let event: {
        choices?: { delta?: { content?: string } }[];
        type?: string;
        text?: string;
        message?: string;
      };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      /* Two dialects on one reader. OpenAI nests the text under
         `choices[0].delta.content`; the gateway emits `{type:'token',text}`.
         Accepting both here keeps one stream parser rather than two that drift. */
      if (event.type === 'error') throw new Error(event.message || 'The gateway reported an error.');
      const delta = event.choices?.[0]?.delta?.content ?? (event.type === 'token' ? event.text : undefined);
      if (delta) {
        state.text += delta;
        onToken?.(state.text, delta);
      }
    }
  }

  return state.text;
}

async function callProvider(provider: Provider, request: ChatRequest): Promise<ChatResult> {
  const model = provider.models[request.tier]!;
  const started = Date.now();
  const stream = Boolean(request.onToken);

  const controller = new AbortController();
  const stoppedByCaller = () => Boolean(request.signal?.aborted);
  if (request.signal) {
    if (request.signal.aborted) controller.abort();
    else request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  /* The gateway takes a MODE and its own auth headers; a direct provider takes a
     model name and a bearer key. Everything downstream — streaming, failover,
     cooldown — is identical, so only the request differs. */
  const isGateway = provider.protocol === 'gateway';
  const secret = process.env[provider.keyEnv] ?? '';

  const url = isGateway ? provider.baseUrl.replace(/\/$/, '') + '/v1/chat' : provider.baseUrl + '/chat/completions';

  const headers: Record<string, string> = isGateway
    ? {
        'Content-Type': 'application/json',
        'X-Syrix-Token': secret,
        'X-Syrix-Device': process.env.FORMA_AI_GATEWAY_DEVICE || 'syrix-forma'
      }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };

  /* MEDIA GOES TO THE GATEWAY ONLY.
   *
   * The gateway takes images on its own `media` field. A direct OpenAI-shaped
   * provider expects them inline in the message content as a parts array, which
   * is a different request shape entirely — sending `media` to one would be
   * ignored at best, and the model would then answer about a picture it never
   * saw. The direct providers are a local-development fallback, so rather than
   * maintain a second multimodal encoding for them, images simply do not go
   * that way, and `hasMedia` above lets the caller say so honestly. */
  const payload = isGateway
    ? {
        mode: model,
        messages: request.messages,
        ...(request.media?.length ? { media: request.media } : {}),
        temperature: request.temperature ?? 0.3,
        maxTokens: request.maxTokens ?? 1600,
        stream
      }
    : {
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 1600,
        stream
      };

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      /* The body can carry a provider-side explanation, but it can also carry
         the key back in an echoed request. Only the status and any Retry-After
         are kept — never the body — so nothing secret reaches a log line. */
      const retryAfter = Number(response.headers.get('retry-after')) || undefined;
      const error = new Error(`${provider.label} answered ${response.status}.`);
      (error as Error & { status?: number; retryAfter?: number }).status = response.status;
      (error as Error & { retryAfter?: number }).retryAfter = retryAfter;
      throw error;
    }

    let text: string;
    if (stream) {
      text = await readStream(response, request.onToken, { text: '' });
    } else {
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        text?: string;
      };
      /* The gateway answers with a flat `text`; a direct provider nests it. */
      text = body.choices?.[0]?.message?.content ?? body.text ?? '';
    }

    /* An empty completion is a FAILURE, not an answer.
     *
     * Observed against a real prompt: past a certain size the model returned
     * HTTP 200 with an empty string rather than an error. Accepting that
     * produced a blank reply with citations under it, which reads as "there is
     * no answer" — the most misleading output this system can produce. Raised as
     * a retryable failure so the chain moves on and the caller can retry
     * smaller, and so it can never reach a user silently. */
    if (!text.trim()) {
      const empty = new Error(`${provider.label} returned an empty completion.`);
      (empty as Error & { status?: number }).status = 502;
      throw empty;
    }

    return { text, provider: provider.label, model, ms: Date.now() - started, skipped: [] };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (stoppedByCaller()) throw new StoppedError();
      const timeout = new Error(`${provider.label} did not answer in time.`);
      (timeout as Error & { status?: number }).status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one round, walking the chain until a provider answers.
 *
 * Streaming and failover interact badly and the interaction is handled rather
 * than ignored: once a provider has emitted its first token the caller has
 * already seen partial output, so failing over would splice two different
 * answers together. A provider that fails mid-stream therefore ends the round
 * rather than handing on.
 */
export async function chat(request: ChatRequest): Promise<ChatResult> {
  const carriesHubContext = request.carriesHubContext !== false;
  const chain = chainFor(request.tier, { carriesHubContext });
  const attempts: { provider: string; reason: string }[] = [];

  if (!chain.length) {
    throw new ChainExhaustedError(
      carriesHubContext
        ? 'No provider is configured that is cleared to receive Hub context. Set a key for one that does not retain input.'
        : 'No model provider is configured. Set at least one provider key.',
      attempts
    );
  }

  for (const provider of chain) {
    if (isCooling(provider.id)) {
      attempts.push({ provider: provider.label, reason: 'cooling down after a rate limit' });
      continue;
    }

    /* Each provider gets its own token sink so a failed partial stream cannot
       leave half an answer in the caller's buffer before the next one starts. */
    let emitted = false;
    const guardedOnToken = request.onToken
      ? (full: string, delta: string) => {
          emitted = true;
          request.onToken!(full, delta);
        }
      : undefined;

    try {
      const result = await callProvider(provider, { ...request, onToken: guardedOnToken });
      return { ...result, skipped: attempts };
    } catch (error) {
      if (error instanceof StoppedError) throw error;

      const status = (error as Error & { status?: number }).status ?? 0;
      const retryAfter = (error as Error & { retryAfter?: number }).retryAfter;
      const reason = error instanceof Error ? error.message : String(error);

      if (status === 429) markCooling(provider.id, retryAfter);
      attempts.push({ provider: provider.label, reason });

      if (emitted) {
        throw new Error(`${provider.label} failed partway through the answer. ${reason}`);
      }
      if (status && !shouldFailOver(status)) throw error;
    }
  }

  throw new ChainExhaustedError(
    'Every model provider refused this request. ' + attempts.map((a) => `${a.provider}: ${a.reason}`).join('; '),
    attempts
  );
}

/** Which providers could serve a request right now. Used by the probe and the operator-facing status. */
/**
 * Whether a request carrying images can actually be served right now.
 *
 * Only the gateway protocol carries them (see `callProvider`), so this is the
 * question "is the gateway configured and first in line". Callers use it to
 * tell the user their screenshot cannot be looked at, instead of sending it
 * somewhere that will silently drop it and then answer about it anyway.
 */
export function canSendMedia(tier: Tier, carriesHubContext: boolean): boolean {
  const chain = chainFor(tier, { carriesHubContext });
  return chain.some((provider) => provider.protocol === 'gateway' && !isCooling(provider.id));
}

export function chainStatus(tier: Tier, carriesHubContext: boolean) {
  return chainFor(tier, { carriesHubContext }).map((provider) => ({
    provider: provider.label,
    model: provider.models[tier],
    retainsInput: provider.retainsInput,
    cooling: isCooling(provider.id),
    commercialUseConfirmed: provider.commercialUseConfirmed
  }));
}

export { isConfigured };
