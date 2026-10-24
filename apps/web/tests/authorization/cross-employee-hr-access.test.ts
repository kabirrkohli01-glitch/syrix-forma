import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/client';
import { employeePay, employeeProfiles, employees } from '@/lib/db/schema';
import { encryptHrField } from '@/lib/hr/crypto';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

// Exercises the real query layer against the real database, not the pure predicates — those
// are covered in tests/permissions/hr-access.unit.test.ts. The point of this file is that a
// caller who reaches getEmployeeHrRecord/listVisibleEmployees directly, bypassing every screen,
// gets exactly the same answer the UI would give them (engineering rule 10).
const { getEmployeeHrRecord, listVisibleEmployees } = await import('@/features/hr/utils/queries');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  report: `test_${runId}_report`,
  manager: `test_${runId}_manager`,
  colleague: `test_${runId}_colleague`,
  admin: `test_${runId}_admin`,
  hr: `test_${runId}_hr`,
  finance: `test_${runId}_finance`,
  security: `test_${runId}_security`
};

const ids: Record<keyof typeof clerkIds, string> = {
  report: '',
  manager: '',
  colleague: '',
  admin: '',
  hr: '',
  finance: '',
  security: ''
};

function caller(
  key: keyof typeof clerkIds,
  overrides: Partial<ActiveEmployee> = {}
): ActiveEmployee {
  return {
    id: ids[key],
    clerkUserId: clerkIds[key],
    name: key,
    displayName: key,
    email: `${clerkIds[key]}@example.test`,
    role: 'EMPLOYEE',
    team: 'alpha',
    managerId: null,
    financeAccess: false,
    hrAdmin: false,
    ...overrides
  };
}

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.manager,
        name: 'HR Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.colleague,
        name: 'HR Test Colleague',
        email: `${clerkIds.colleague}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.admin,
        name: 'HR Test Admin',
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        team: null,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.hr,
        name: 'HR Test HR',
        email: `${clerkIds.hr}@example.test`,
        role: 'HR_ADMIN',
        team: null,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.finance,
        name: 'HR Test Finance',
        email: `${clerkIds.finance}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active',
        financeAccess: true
      },
      {
        clerkUserId: clerkIds.security,
        name: 'HR Test Security',
        email: `${clerkIds.security}@example.test`,
        role: 'SECURITY_ADMIN',
        team: null,
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  for (const row of inserted) {
    const key = (Object.keys(clerkIds) as (keyof typeof clerkIds)[]).find(
      (k) => clerkIds[k] === row.clerkUserId
    );
    if (key) ids[key] = row.id;
  }

  // The report is inserted after the manager so it can name them as its line manager.
  const [report] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIds.report,
      name: 'HR Test Report',
      email: `${clerkIds.report}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active',
      managerId: ids.manager
    })
    .returning({ id: employees.id });
  ids.report = report.id;

  await db.insert(employeeProfiles).values({
    employeeId: ids.report,
    jobTitle: 'Test Analyst',
    dateOfBirth: '1990-04-01',
    nationalInsuranceEncrypted: encryptHrField('QQ123456C'),
    addressLine1: '1 Test Street',
    addressCity: 'London'
  });

  await db.insert(employeePay).values({
    employeeId: ids.report,
    annualSalaryEncrypted: encryptHrField('52000'),
    currency: 'GBP',
    payFrequency: 'monthly'
  });
});

afterAll(async () => {
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('HR record bands, read through the real query layer', () => {
  it('gives an employee every band of their own record', async () => {
    const record = await getEmployeeHrRecord(
      caller('report', { managerId: ids.manager }),
      ids.report
    );
    expect(record).not.toBeNull();
    expect(record!.employment?.jobTitle).toBe('Test Analyst');
    expect(record!.identity?.nationalInsurance).toBe('QQ123456C');
    expect(record!.pay?.annualSalary).toBe('52000');
  });

  it('gives a line manager the employment band but withholds identity and pay', async () => {
    const record = await getEmployeeHrRecord(caller('manager', { role: 'MANAGER' }), ids.report);
    expect(record).not.toBeNull();
    expect(record!.employment?.jobTitle).toBe('Test Analyst');
    expect(record!.identity).toBeNull();
    expect(record!.pay).toBeNull();
  });

  it('hides a same-team colleague entirely from a plain EMPLOYEE', async () => {
    expect(await getEmployeeHrRecord(caller('colleague'), ids.report)).toBeNull();
  });

  it('hides an arbitrary employee from an ADMIN — platform admin is not HR access', async () => {
    expect(await getEmployeeHrRecord(caller('admin', { role: 'ADMIN' }), ids.report)).toBeNull();
  });

  it('hides everything from SECURITY_ADMIN, including their own record', async () => {
    expect(
      await getEmployeeHrRecord(caller('security', { role: 'SECURITY_ADMIN' }), ids.report)
    ).toBeNull();
    expect(
      await getEmployeeHrRecord(caller('security', { role: 'SECURITY_ADMIN' }), ids.security)
    ).toBeNull();
  });

  it('gives HR_ADMIN every band for anyone', async () => {
    const record = await getEmployeeHrRecord(caller('hr', { role: 'HR_ADMIN' }), ids.report);
    expect(record!.identity?.nationalInsurance).toBe('QQ123456C');
    expect(record!.pay?.annualSalary).toBe('52000');
  });

  it('gives a finance user pay, and nothing but pay', async () => {
    const record = await getEmployeeHrRecord(
      caller('finance', { financeAccess: true }),
      ids.report
    );
    expect(record).not.toBeNull();
    expect(record!.pay?.annualSalary).toBe('52000');
    // A finance user is entitled to pay company-wide and to no other band. Opening a record
    // must not become a side door to employment or identity detail.
    expect(record!.identity).toBeNull();
    expect(record!.employment).toBeNull();
  });

  it('stores the salary and NI number encrypted, not as plaintext', async () => {
    const [pay] = await db.select().from(employeePay).where(eq(employeePay.employeeId, ids.report));
    const [profile] = await db
      .select()
      .from(employeeProfiles)
      .where(eq(employeeProfiles.employeeId, ids.report));
    expect(pay.annualSalaryEncrypted).not.toContain('52000');
    expect(profile.nationalInsuranceEncrypted).not.toContain('QQ123456C');
  });
});

describe('listVisibleEmployees scope', () => {
  it('shows a plain employee only themselves', async () => {
    const rows = await listVisibleEmployees(caller('colleague'));
    const testRows = rows.filter((r) => Object.values(ids).includes(r.id));
    expect(testRows.map((r) => r.id)).toEqual([ids.colleague]);
  });

  it('shows a line manager themselves plus their direct reports', async () => {
    const rows = await listVisibleEmployees(caller('manager', { role: 'MANAGER' }));
    const testIds = rows.filter((r) => Object.values(ids).includes(r.id)).map((r) => r.id);
    expect(testIds).toContain(ids.manager);
    expect(testIds).toContain(ids.report);
    expect(testIds).not.toContain(ids.colleague);
  });

  it('shows SECURITY_ADMIN nobody', async () => {
    expect(await listVisibleEmployees(caller('security', { role: 'SECURITY_ADMIN' }))).toEqual([]);
  });

  it('shows a finance user the whole company, so the pay they may read is reachable', async () => {
    const rows = await listVisibleEmployees(caller('finance', { financeAccess: true }));
    const testIds = rows.filter((r) => Object.values(ids).includes(r.id)).map((r) => r.id);
    expect(testIds).toContain(ids.report);
    expect(testIds).toContain(ids.colleague);
  });

  it('shows HR_ADMIN the whole company', async () => {
    const rows = await listVisibleEmployees(caller('hr', { role: 'HR_ADMIN' }));
    const testIds = rows.filter((r) => Object.values(ids).includes(r.id)).map((r) => r.id);
    expect(testIds).toContain(ids.report);
    expect(testIds).toContain(ids.colleague);
    expect(testIds).toContain(ids.admin);
  });
});
