import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeMcpServer } from '@/lib/connectors/mcp-client';

/**
 * Runs the MCP client against a real server over a real socket.
 *
 * Mocking `fetch` here would test that the code calls fetch, which is not the thing that breaks.
 * What breaks is the wire format: whether the client sends a body a server accepts, and whether
 * it can read a reply that arrives as an event stream rather than as JSON. Both are exercised
 * below against a server started on a loopback port.
 */

type Handler = (method: string, id: unknown) => { body: string; contentType: string; status?: number };

let server: Server;
let port = 0;
let handler: Handler;

function jsonResponse(result: unknown, id: unknown) {
  return {
    body: JSON.stringify({ jsonrpc: '2.0', id, result }),
    contentType: 'application/json'
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(raw || '{}') as { method?: string; id?: unknown };
      const out = handler(parsed.method ?? '', parsed.id);
      res.writeHead(out.status ?? 200, { 'content-type': out.contentType });
      res.end(out.body);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function url() {
  return `http://127.0.0.1:${port}/mcp`;
}

describe('probing an MCP server', () => {
  it('reads the server name and its tools from a JSON reply', async () => {
    handler = (method, id) => {
      if (method === 'initialize') {
        return jsonResponse(
          {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'Test Server', version: '1.2.3' }
          },
          id
        );
      }
      return jsonResponse(
        {
          tools: [
            { name: 'search_companies', description: 'Look up a company' },
            { name: 'get_filing' }
          ]
        },
        id
      );
    };

    const result = await probeMcpServer({ baseUrl: url() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.serverName).toBe('Test Server');
    expect(result.serverVersion).toBe('1.2.3');
    expect(result.tools.map((tool) => tool.name)).toEqual(['search_companies', 'get_filing']);
    expect(result.tools[1].description).toBeNull();
  });

  it('reads a reply that arrives as an event stream, not as JSON', async () => {
    handler = (method, id) => {
      const payload =
        method === 'initialize'
          ? { protocolVersion: '2025-06-18', serverInfo: { name: 'Streamed', version: '1' } }
          : { tools: [{ name: 'streamed_tool', description: null }] };

      return {
        // A keep-alive comment and an unrelated frame first, exactly as a live server interleaves
        // them — a client that reads only the first data frame would fail on this.
        body: `: keep-alive\n\nevent: message\ndata: {"jsonrpc":"2.0","id":999,"result":{}}\n\nevent: message\ndata: ${JSON.stringify(
          { jsonrpc: '2.0', id, result: payload }
        )}\n\n`,
        contentType: 'text/event-stream'
      };
    };

    const result = await probeMcpServer({ baseUrl: url() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverName).toBe('Streamed');
    expect(result.tools.map((tool) => tool.name)).toEqual(['streamed_tool']);
  });

  it('stays connected when the server offers no tool list', async () => {
    handler = (method, id) => {
      if (method === 'initialize') {
        return jsonResponse({ serverInfo: { name: 'Toolless', version: '1' } }, id);
      }
      return {
        body: JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'no tools' } }),
        contentType: 'application/json'
      };
    };

    const result = await probeMcpServer({ baseUrl: url() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tools).toEqual([]);
  });

  it('reports a refusal as a sentence rather than throwing', async () => {
    handler = (_method, id) => ({
      body: JSON.stringify({ jsonrpc: '2.0', id, error: { message: 'token rejected' } }),
      contentType: 'application/json'
    });

    const result = await probeMcpServer({ baseUrl: url(), authorizationHeader: 'Bearer wrong' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/token rejected/);
  });

  it('reports an HTTP failure rather than treating it as connected', async () => {
    handler = (_method, id) => ({
      body: JSON.stringify({ jsonrpc: '2.0', id, error: {} }),
      contentType: 'application/json',
      status: 500
    });

    const result = await probeMcpServer({ baseUrl: url() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/500/);
  });

  it('refuses an address the URL guard rejects, without making a request', async () => {
    const result = await probeMcpServer({ baseUrl: 'https://169.254.169.254/latest/meta-data/' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/private network/i);
  });
});
