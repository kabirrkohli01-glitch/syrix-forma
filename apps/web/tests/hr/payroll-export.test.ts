import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { auditLog, employeeProfiles, employees } from '@/lib/db/schema';
import { toCsv } from '@/lib/hr/csv';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { exportPayrollCsv } = await import('@/features/hr/payroll-actions');

const TEST_SESSION = 'sess_test_payroll';

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  worker: `test_${runId}_worker`,
  manager: `test_${runId}_manager`,
  admin: `test_${runId}_admin`,
  finance: `test_${runId}_finance`,
  hr: `test_${runId}_hr`
};
const ids: Record<keyof typeof clerkIds, string> = {
  worker: '',
  manager: '',
  admin: '',
  finance: '',
  hr: ''
};


beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.worker,
        name: 'Payroll Test Worker',
        email: `${clerkIds.worker}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.manager,
        name: 'Payroll Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.admin,
        name: 'Payroll Test Admin',
        email: `${clerkIds.admin}@example.test`,
        role: 'ADMIN',
        team: null,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.finance,
        name: 'Payroll Test Finance',
        email: `${clerkIds.finance}@example.test`,
        role: 'EMPLOYEE',
        team: 'alpha',
        status: 'active',
        financeAccess: true
      },
      {
        clerkUserId: clerkIds.hr,
        name: 'Payroll Test HR',
        email: `${clerkIds.hr}@example.test`,
        role: 'HR_ADMIN',
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

  // A starter inside the export window, so the file has something real in it.
  await db.insert(employeeProfiles).values({
    employeeId: ids.worker,
    jobTitle: 'Analyst',
    startDate: '2026-05-11'
  });
});

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.actorEmployeeId, Object.values(ids)));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('CSV serialisation', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['plain', 'has, comma'],
        ['has "quote"', 'has\nnewline']
      ]
    );
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"has\nnewline"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // An employee can put this in their own name or an expense description, and it executes
    // when the exported file is opened unless the leading character is escaped.
    const csv = toCsv(['name'], [["=cmd|'/c calc'!A1"], ['+1+1'], ['-1'], ['@SUM(A1)']]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'-1");
    expect(csv).toContain("'@SUM(A1)");
    // The dangerous form must not survive at the start of a cell.
    expect(csv).not.toMatch(/(^|,)=cmd/u);
  });

  it('renders empty cells for null and undefined rather than the words', () => {
    const csv = toCsv(['a', 'b', 'c'], [['x', null, undefined]]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
    expect(csv.trim().split('\r\n')[1]).toBe('x,,');
  });

  it('ends every line with CRLF per RFC 4180', () => {
    expect(toCsv(['a'], [['b']])).toBe('a\r\nb\r\n');
  });
});

describe('payroll export authorization', () => {
  const period = { from: '2026-05-01', to: '2026-05-31' };

  it('refuses a plain employee', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker, sessionId: TEST_SESSION });
    await expect(exportPayrollCsv(period)).rejects.toThrow(/cannot export payroll/i);
  });

  it('refuses a line manager', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager, sessionId: TEST_SESSION });
    await expect(exportPayrollCsv(period)).rejects.toThrow(/cannot export payroll/i);
  });

  it('refuses an ADMIN — platform administration is not HR access', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.admin, sessionId: TEST_SESSION });
    await expect(exportPayrollCsv(period)).rejects.toThrow(/cannot export payroll/i);
  });

  it('records a denied attempt in the audit log', async () => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.actorEmployeeId, [ids.worker, ids.manager, ids.admin]));

    const denials = rows.filter(
      (row) => row.action === 'payroll_exported' && row.result === 'denied'
    );
    // One per refused caller above — a refusal nobody records is a refusal nobody can review.
    expect(denials.length).toBeGreaterThanOrEqual(3);
  });

  it('allows a finance user and produces a real file', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.finance, sessionId: TEST_SESSION });
    const result = await exportPayrollCsv(period);

    expect(result.filename).toBe('payroll-changes-2026-05-01-to-2026-05-31.csv');
    expect(result.csv.startsWith('Employee,Employee ID,Change,Detail,Amount')).toBe(true);
    expect(result.csv).toContain('Payroll Test Worker');
    expect(result.csv).toContain('starter');
  });

  it('allows HR', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr, sessionId: TEST_SESSION });
    const result = await exportPayrollCsv(period);
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('records the successful export without reproducing its contents', async () => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.actorEmployeeId, [ids.finance, ids.hr]));

    const successes = rows.filter(
      (row) => row.action === 'payroll_exported' && row.result === 'success'
    );
    expect(successes.length).toBeGreaterThanOrEqual(2);

    for (const entry of successes) {
      const metadata = entry.metadata as Record<string, unknown>;
      expect(metadata.from).toBe('2026-05-01');
      expect(typeof metadata.rowCount).toBe('number');
      // The audit entry must not be a second copy of the thing it is protecting.
      expect(JSON.stringify(metadata)).not.toContain('Payroll Test Worker');
    }
  });

  it('rejects a backwards period', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr, sessionId: TEST_SESSION });
    await expect(exportPayrollCsv({ from: '2026-05-31', to: '2026-05-01' })).rejects.toThrow();
  });

  it('excludes standing salaries from the file', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr, sessionId: TEST_SESSION });
    const result = await exportPayrollCsv(period);
    // The export carries changes only. A column of everyone's salary would widen what this
    // file costs if it leaks, for no added use to a payroll run.
    expect(result.csv.toLowerCase()).not.toContain('salary');
  });
});
