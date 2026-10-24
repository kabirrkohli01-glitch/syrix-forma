import { eq, inArray } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, leaveAllowances } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth(), currentUser: vi.fn() }));

const { default: HrSettingsPage } = await import('@/app/dashboard/hr/settings/page');
const { currentLeaveYear } = await import('@/features/hr/utils/leave-queries');

const runTag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  /** An ADMIN holding the capability — the case the whole flag exists for. */
  admin: `test_${runTag}_admin`,
  employee: `test_${runTag}_employee`
};
let employeeId = '';

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.admin,
        name: `HR Settings Admin ${runTag}`,
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        status: 'active',
        hrAdmin: true
      },
      {
        clerkUserId: clerkIds.employee,
        name: `HR Settings Employee ${runTag}`,
        email: `${clerkIds.employee}@example.test`,
        role: 'EMPLOYEE',
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  employeeId = inserted.find((row) => row.clerkUserId === clerkIds.employee)!.id;

  const year = await currentLeaveYear();
  await db.insert(leaveAllowances).values({
    employeeId,
    leaveYearStart: year.start,
    entitlementHalfDays: 66
  });
});

afterAll(async () => {
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

async function render(as: keyof typeof clerkIds) {
  mockAuth.mockResolvedValue({ userId: clerkIds[as] });
  return renderToStaticMarkup(await HrSettingsPage());
}

describe('HrSettingsPage', () => {
  it('shows the policy, the leave types and everyone’s entitlement to an HR administrator', async () => {
    const html = await render('admin');

    expect(html).toContain('Leave policy');
    expect(html).toContain('Days off per year');
    expect(html).toContain('Leave types');
    expect(html).toContain('Individual allowances');
    expect(html).toContain('Public holidays');

    // The employee given 66 half days shows as 33 days, and is not marked as on the default.
    expect(html).toContain(`HR Settings Employee ${runTag}`);
    expect(html).toContain('33 days');

    // Someone with no allowance row is shown as being on the company default, which is a
    // different statement from having been given a figure.
    expect(html).toContain('Default');
  });

  it('tells someone without the capability what would let them in, rather than 404ing', async () => {
    const html = await render('employee');

    expect(html).toContain('You do not have HR administration');
    expect(html).toContain('People');
    // No form is rendered for them at all.
    expect(html).not.toContain('Days off per year');
  });
});
