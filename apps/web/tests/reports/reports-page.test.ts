import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: ReportsPage } = await import('@/app/dashboard/reports/page');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdEmployee = `test_${runTag}_employee`;
const clerkIdManager = `test_${runTag}_manager`;
const clerkIdAdmin = `test_${runTag}_admin`;

beforeAll(async () => {
  await db.insert(employees).values([
    {
      clerkUserId: clerkIdEmployee,
      name: `Reports Page Employee ${runTag}`,
      email: `${clerkIdEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    },
    {
      clerkUserId: clerkIdManager,
      name: `Reports Page Manager ${runTag}`,
      email: `${clerkIdManager}@example.test`,
      role: 'MANAGER',
      team: 'alpha',
      status: 'active'
    },
    {
      clerkUserId: clerkIdAdmin,
      name: `Reports Page Admin ${runTag}`,
      email: `${clerkIdAdmin}@example.test`,
      role: 'ADMIN',
      team: 'alpha',
      status: 'active'
    }
  ]);
});

afterAll(async () => {
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdManager));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAdmin));
});

describe('ReportsPage', () => {
  it('denies a plain EMPLOYEE (docs/permissions-matrix.md: Reports (basic) is MANAGER/ADMIN only)', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdEmployee });

    const element = await ReportsPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('Workload');
  });

  it('shows a MANAGER every section except Automation performance', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdManager });

    const element = await ReportsPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Workload');
    expect(html).toContain('Team workload');
    expect(html).toContain('Active projects');
    expect(html).toContain('Project health');
    expect(html).toContain('Overdue work');
    expect(html).toContain('Client activity');
    expect(html).toContain('Response times');
    expect(html).toContain('Operational trends');
    expect(html).not.toContain('Automation performance');
  });

  it('additionally shows an ADMIN the Automation performance section', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAdmin });

    const element = await ReportsPage();
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Automation performance');
  });
});
