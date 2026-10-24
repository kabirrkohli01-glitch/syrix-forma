import { eq, inArray } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clients, documentFiles, employees } from '@/lib/db/schema';

/**
 * Renders the real page against the real database, the same shape as the other page tests.
 *
 * This is the check that the screen actually comes out — a page can typecheck, pass every action
 * test and still throw on render, and the routes cannot be opened in a browser from here because
 * they redirect to sign-in first.
 */

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: DocumentsPage } = await import('@/app/dashboard/documents/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const team = `docs-page-${runTag}`;
const clerkIds = {
  employee: `test_${runTag}_employee`,
  security: `test_${runTag}_security`
};
let employeeId = '';
let clientId = '';

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.employee,
        name: `Docs Page Employee ${runTag}`,
        email: `${clerkIds.employee}@example.test`,
        role: 'EMPLOYEE',
        team,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.security,
        name: `Docs Page Security ${runTag}`,
        email: `${clerkIds.security}@example.test`,
        role: 'SECURITY_ADMIN',
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  employeeId = inserted.find((row) => row.clerkUserId === clerkIds.employee)!.id;

  const [client] = await db
    .insert(clients)
    .values({ name: `Docs Page Client ${runTag}`, team, isSeedData: true })
    .returning({ id: clients.id });
  clientId = client.id;

  await db.insert(documentFiles).values({
    title: `Engagement letter ${runTag}`,
    storageKey: `documents/${runTag}`,
    fileName: 'engagement-letter.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 4096,
    team,
    clientId,
    uploadedByEmployeeId: employeeId
  });
});

afterAll(async () => {
  await db.delete(documentFiles).where(eq(documentFiles.team, team));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

async function render(as: keyof typeof clerkIds) {
  mockAuth.mockResolvedValue({ userId: clerkIds[as] });
  return renderToStaticMarkup(await DocumentsPage());
}

describe('DocumentsPage', () => {
  it('renders a document the caller can see, with the record it belongs to', async () => {
    const html = await render('employee');
    expect(html).toContain(`Engagement letter ${runTag}`);
    expect(html).toContain('engagement-letter.pdf');
    expect(html).toContain(`Docs Page Client ${runTag}`);
    // Both ways of adding one are offered, not just the upload.
    expect(html).toContain('Upload');
    expect(html).toContain('Link a file');
  });

  it('tells a SECURITY_ADMIN why they see nothing rather than showing an empty list', async () => {
    const html = await render('security');
    expect(html).toContain('Documents are business data');
    expect(html).not.toContain(`Engagement letter ${runTag}`);
  });
});
