/* The provider chain.
 *
 * SYRIX AI must be free and must not run out. No single free tier delivers both:
 * every one of them has a request-per-minute or request-per-day ceiling, and a
 * ceiling reached mid-afternoon is an assistant that stopped working. So there
 * is no single provider — there is an ordered chain, and a request walks it
 * until one answers.
 *
 * Every provider here speaks the OpenAI chat-completions shape, which is why one
 * adapter serves all of them: they differ by base URL, key, and model name, not
 * by protocol. A provider that needed a different protocol would get its own
 * adapter rather than distorting this one.
 *
 * TWO CHAINS, NOT ONE — this is a privacy boundary, not an optimisation.
 * Several free tiers pay for themselves by training on what you send them.
 * That is acceptable for "what is the Skilled Worker salary threshold", which
 * is a public question about a public rule. It is not acceptable for anything
 * carrying Hub context, even after redaction, because redaction is a control
 * that can have gaps and training is irreversible. So a provider is marked with
 * whether it retains input, and requests that touch Hub data are only ever
 * offered to providers that do not.
 *
 * NOTHING HERE HOLDS A KEY IN THE APP LONG-TERM. Keys are read from the
 * environment now so the pipeline can be built and tested; the shipped form
 * moves this chain behind a Cloudflare Worker that holds the keys as secrets and
 * hands the Hub only a revocable tenant token (see docs/forma-ai-architecture.md
 * §2). The request shape below is already the Worker's request shape, so that
 * move is a configuration change rather than a rewrite.
 */

export type Tier =
  /** Small and fast. Conversation, routing, short summaries. */
  | 'spark'
  /** The main model. Research synthesis, council specialists, the chief. */
  | 'zenith';

export type Protocol =
  /** OpenAI chat-completions. Every direct provider speaks this. */
  | 'openai'
  /**
   * The paired gateway's own dialect: a mode rather than a model name, and a
   * reduced event stream (`token` / `tool_call` / `error` / `done`). Matches the
   * Worker already serving the Vantage terminal, so the same deployment serves
   * both without being redeployed.
   */
  | 'gateway';

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  protocol: Protocol;
  /** Environment variable holding the key or device token. Never the value itself. */
  keyEnv: string;
  /** Model to use per tier. A provider that serves only one tier omits the other. */
  models: Partial<Record<Tier, string>>;
  /**
   * Whether this provider may retain or train on request content.
   * `true` bars it from any request carrying Hub context — see the note above.
   */
  retainsInput: boolean;
  /** Published free-tier ceiling, for the operator-facing note when the chain is exhausted. */
  freeTier: string;
  /**
   * Whether the provider's terms have been confirmed to permit commercial use.
   * SYRIX Forma is an internal business tool, which counts as commercial even with
   * no revenue attached — the same trap the engineering rules flags for Vercel's Hobby tier.
   * A provider stays `false` until someone has actually read the current terms.
   */
  commercialUseConfirmed: boolean;
}

/* Order is deliberate and is the whole failover policy.
 *
 * Fastest-with-a-real-free-tier first, broadest last. OpenRouter sits at the end
 * of both chains because it aggregates other providers' free models: when the
 * named providers are exhausted it is the most likely to still have something,
 * and it is the least predictable about which model that will be. */
export const PROVIDERS: Provider[] = [
  /* First, and the only one that should be configured in a shipped deployment.
   *
   * The gateway is a Cloudflare Worker the operator owns. It holds every
   * provider key as a Worker secret and does the failover between them on its
   * own side; the Hub holds a revocable device token and no key at all. That is
   * the whole point — a compromised Hub leaks nothing worth stealing, and
   * rotating a provider key never touches this repo.
   *
   * The direct providers below exist for local development and as a fallback if
   * the gateway itself is unreachable. In production they stay unset, and the
   * chain is one link long by design. */
  {
    id: 'gateway',
    label: 'Forma gateway',
    baseUrl: process.env.FORMA_AI_GATEWAY_URL || '',
    protocol: 'gateway',
    keyEnv: 'FORMA_AI_GATEWAY_TOKEN',
    /* The Worker maps a mode onto whatever model it currently serves, so model
       names are not this repo's business and cannot drift out of date here. */
    models: { spark: 'spark', zenith: 'zenith' },
    retainsInput: false,
    freeTier: 'per-device allowance set by the gateway',
    commercialUseConfirmed: false
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'openai',
    keyEnv: 'GROQ_API_KEY',
    models: {
      spark: process.env.GROQ_SPARK_MODEL || 'llama-3.1-8b-instant',
      zenith: process.env.GROQ_ZENITH_MODEL || 'llama-3.3-70b-versatile'
    },
    retainsInput: false,
    freeTier: '30 req/min, 14,400 req/day (verify current)',
    commercialUseConfirmed: false
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    protocol: 'openai',
    keyEnv: 'CEREBRAS_API_KEY',
    models: {
      spark: process.env.CEREBRAS_SPARK_MODEL || 'llama3.1-8b',
      zenith: process.env.CEREBRAS_ZENITH_MODEL || 'llama-3.3-70b'
    },
    retainsInput: false,
    freeTier: 'daily token allowance (verify current)',
    commercialUseConfirmed: false
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    protocol: 'openai',
    keyEnv: 'MISTRAL_API_KEY',
    models: {
      spark: process.env.MISTRAL_SPARK_MODEL || 'mistral-small-latest',
      zenith: process.env.MISTRAL_ZENITH_MODEL || 'mistral-large-latest'
    },
    retainsInput: false,
    freeTier: 'free experiment tier (verify current)',
    commercialUseConfirmed: false
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    keyEnv: 'OPENROUTER_API_KEY',
    models: {
      spark: process.env.OPENROUTER_SPARK_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      zenith: process.env.OPENROUTER_ZENITH_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'
    },
    /* OpenRouter's free models are routed to upstreams whose retention policies
       vary and are not individually visible. Treated as retaining. */
    retainsInput: true,
    freeTier: 'varies per model (verify current)',
    commercialUseConfirmed: false
  }
];

export function isConfigured(provider: Provider): boolean {
  if (!process.env[provider.keyEnv]?.trim()) return false;
  /* The gateway's address is configuration rather than a constant, so a token
     without a URL is not a usable link in the chain. */
  return Boolean(provider.baseUrl.trim());
}

/**
 * The chain for one request.
 *
 * `carriesHubContext` is the privacy switch: when true, providers that may
 * retain input are removed entirely rather than merely deprioritised. A
 * deprioritised retaining provider still receives the request the moment the
 * ones above it are rate-limited, which is exactly when the guarantee would
 * matter most.
 */
export function chainFor(tier: Tier, options: { carriesHubContext: boolean }): Provider[] {
  return PROVIDERS.filter(
    (provider) =>
      isConfigured(provider) &&
      Boolean(provider.models[tier]) &&
      (!options.carriesHubContext || !provider.retainsInput)
  );
}

/** Providers configured but not yet cleared for commercial use. Surfaced by the probe, not enforced here. */
export function unverifiedForCommercialUse(): Provider[] {
  return PROVIDERS.filter((provider) => isConfigured(provider) && !provider.commercialUseConfirmed);
}
