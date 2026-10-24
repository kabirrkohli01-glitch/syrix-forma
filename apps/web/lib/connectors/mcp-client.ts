/**
 * The smallest Model Context Protocol client that can answer "is this server real, and what does
 * it offer" — a JSON-RPC `initialize` followed by `tools/list` over Streamable HTTP.
 *
 * Written by hand rather than pulling in `@modelcontextprotocol/sdk` because this needs two
 * request shapes and no session lifecycle: the Hub connects, asks what is there, records it, and
 * disconnects. A dependency whose value is two `fetch` calls is one more thing to audit and keep
 * current (engineering rule 8 — reuse where a mature solution is genuinely doing the work).
 * If the Hub later needs to hold a session, stream notifications or negotiate capabilities
 * properly, replace this with the real SDK rather than growing it.
 *
 * Everything a server returns is untrusted. Tool names and descriptions are stored and displayed,
 * never executed and never fed anywhere that treats text as an instruction (engineering rule 12).
 */

import { describeUrlProblem } from './url-guard';

/** The version this client speaks. Servers negotiate down; a mismatch is reported, not ignored. */
const PROTOCOL_VERSION = '2025-06-18';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export type McpTool = { name: string; description: string | null };

export type McpProbeResult =
  | {
      ok: true;
      serverName: string | null;
      serverVersion: string | null;
      protocolVersion: string | null;
      tools: McpTool[];
    }
  | { ok: false; error: string };

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/**
 * One JSON-RPC call.
 *
 * Accepts either a JSON body or an SSE stream, because a Streamable HTTP server may answer
 * either and a client that only handles one reports a working server as broken. For SSE only the
 * first `data:` frame carrying a response to this id is needed.
 */
async function rpc(
  baseUrl: string,
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown>,
  id: number
): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Both, in preference order — a server that only streams and a server that only returns
        // JSON are both valid, and refusing one of them would be this client's bug.
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_VERSION,
        ...headers
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
      // No cookies, no credentials of the browser's: everything this client sends is what the
      // connector's own stored credential put in `headers`.
      credentials: 'omit',
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`The server answered ${response.status} ${response.statusText}`);
    }

    const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload) as JsonRpcResponse;
          if (parsed.id === id) return parsed;
        } catch {
          // A frame that is not JSON is not this response; keep reading rather than failing the
          // whole call on a keep-alive comment or a partial frame.
        }
      }
      throw new Error('The server streamed a reply that contained no response to this request');
    }

    return JSON.parse(text) as JsonRpcResponse;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

/**
 * Connects, asks what the server is and what tools it exposes, and returns a plain result rather
 * than throwing.
 *
 * A connector failing must never surface as an internal fault, and the message is shown to whoever
 * pasted the URL — so every failure is turned into a sentence that says what to check.
 */
export async function probeMcpServer(input: {
  baseUrl: string;
  authorizationHeader?: string;
}): Promise<McpProbeResult> {
  // Re-checked here, not only where the form validated it: a connector saved once is re-probed
  // later, and a check that only runs on the way in is not a check on the way out.
  const problem = describeUrlProblem(input.baseUrl);
  if (problem) return { ok: false, error: problem };
  const url = new URL(input.baseUrl);

  const headers: Record<string, string> = input.authorizationHeader
    ? { authorization: input.authorizationHeader }
    : {};

  try {
    const initialize = await rpc(
      url.toString(),
      headers,
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        // The Hub asks for nothing. It reads what a server offers and does not offer anything
        // back, which is the whole of its role here.
        capabilities: {},
        clientInfo: { name: 'SYRIX Forma', version: '1.0' }
      },
      1
    );

    if (initialize.error) {
      return {
        ok: false,
        error: initialize.error.message
          ? `The server refused the connection: ${initialize.error.message}`
          : 'The server refused the connection'
      };
    }

    const result = asRecord(initialize.result);
    const serverInfo = asRecord(result.serverInfo);

    let tools: McpTool[] = [];
    try {
      const listed = await rpc(url.toString(), headers, 'tools/list', {}, 2);
      const listResult = asRecord(listed.result);
      if (Array.isArray(listResult.tools)) {
        tools = listResult.tools
          .map((tool): McpTool | null => {
            const record = asRecord(tool);
            const name = asString(record.name);
            return name ? { name, description: asString(record.description) } : null;
          })
          .filter((tool): tool is McpTool => tool !== null)
          .slice(0, 100);
      }
    } catch {
      // A server that connects but exposes no tool list is still connected. Reporting the whole
      // connector as broken because of an optional second call would be wrong.
      tools = [];
    }

    return {
      ok: true,
      serverName: asString(serverInfo.name),
      serverVersion: asString(serverInfo.version),
      protocolVersion: asString(result.protocolVersion),
      tools
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'The server did not answer within 10 seconds' };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The server could not be reached'
    };
  }
}
