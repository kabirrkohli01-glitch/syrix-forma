import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { calendarEvents, clientNotes, clientStaff, clients, emailActivity, employees } from '@/lib/db/schema';

// Same rationale as the other tests/*/*.test.ts direct-render pages: no dev-only auth bypass and
// no browser-automation tool in this environment.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: ClientDetailPage } = await import('@/app/dashboard/clients/[id]/page');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdEmployee = `test_${runId}_employee`;

let employeeId: string;
let clientId: string;

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdEmployee,
      name: 'Client Page Employee',
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  employeeId = employee.id;

  const [client] = await db.insert(clients).values({ name: 'Expanded Client Centre Co', team: 'alpha' }).returning();
  clientId = client.id;
  await db.insert(clientStaff).values({ clientId, employeeId });

  const now = new Date();
  await db.insert(calendarEvents).values({
    title: 'Quarterly review meeting',
    team: 'alpha',
    createdByEmployeeId: employeeId,
    clientId,
    startAt: now,
    endAt: now
  });
  await db.insert(emailActivity).values({
    direction: 'inbound',
    externalMessageId: `msg-${runId}`,
    mailboxResourceId: 'mailbox-1',
    fromAddress: 'client@example.test',
    toAddresses: ['team@example.test'],
    subject: 'Re: quarterly figures',
    occurredAt: now,
    clientId
  });
  await db.insert(clientNotes).values({ clientId, authorEmployeeId: employeeId, body: 'Client prefers morning calls' });
});

afterAll(async () => {
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
});

describe('ClientDetailPage — Phase 5 expansion', () => {
  it('renders linked meetings, emails, and notes', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    const element = await ClientDetailPage({ params: Promise.resolve({ id: clientId }) });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Quarterly review meeting');
    expect(html).toContain('Re: quarterly figures');
    expect(html).toContain('Client prefers morning calls');
  });
});
