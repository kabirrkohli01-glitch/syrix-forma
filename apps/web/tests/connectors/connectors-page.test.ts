import { inArray } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { connectors, employees } from '@/lib/db/schema';
import { encryptIntegrationCredentials } from '@/lib/integrations/crypto';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

// notFound() throws a Next.js control-flow error; caught below to assert the 404 path without
// pulling in the framework's own dispatcher.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));

const { default: ConnectorsPage } = await import('@/app/dashboard/settings/connectors/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = { admin: `test_${runTag}_admin`, employee: `test_${runTag}_employee` };
const connectorName = `Test MCP ${runTag}`;
const SECRET = 'super-secret-token-value-do-not-render';

beforeAll(async () => {
  await db.insert(employees).values([
    {
      clerkUserId: clerkIds.admin,
      name: `Connectors Admin ${runTag}`,
      email: `${clerkIds.admin}@example.test`,
      role: 'ADMIN',
      status: 'active'
    },
    {
      clerkUserId: clerkIds.employee,
      name: `Connectors Employee ${runTag}`,
      email: `${clerkIds.employee}@example.test`,
      role: 'EMPLOYEE',
      status: 'active'
    }
  ]);

  await db.insert(connectors).values({
    kind: 'mcp',
    name: connectorName,
    catalogueKey: 'mcp',
    baseUrl: 'https://example.com/mcp',
    status: 'connected',
    credentialsEncrypted: encryptIntegrationCredentials(JSON.stringify({ token: SECRET })),
    config: { serverName: 'Example Server', tools: [{ name: 'search_things', description: null }] }
  });
});

afterAll(async () => {
  await db.delete(connectors).where(inArray(connectors.name, [connectorName]));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

async function render(as: keyof typeof clerkIds) {
  mockAuth.mockResolvedValue({ userId: clerkIds[as] });
  return renderToStaticMarkup(await ConnectorsPage());
}

describe('ConnectorsPage', () => {
  it('shows a connector, its discovered tools, and never its credential', async () => {
    const html = await render('admin');

    expect(html).toContain(connectorName);
    expect(html).toContain('Example Server');
    expect(html).toContain('search_things');
    expect(html).toContain('credential stored');

    // The whole point of the storage design: the secret exists, the page knows one exists, and
    // the rendered markup cannot contain it.
    expect(html).not.toContain(SECRET);
  });

  it('lists services with no Hub code behind them as exactly that', async () => {
    const html = await render('admin');
    expect(html).toContain('Not wired up yet');
    expect(html).toContain('Slack');
  });

  it('does not confirm to a non-admin that the page exists', async () => {
    await expect(render('employee')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
