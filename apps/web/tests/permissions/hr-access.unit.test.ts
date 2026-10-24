import { describe, expect, it } from 'vitest';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canEditEmployeePay,
  canEditEmployeeRecord,
  canEditOwnProfileContactDetails,
  canExportPayroll,
  canManageHrSettings,
  canViewEmployeeIdentity,
  canViewEmployeePay,
  canViewEmployeeRecord,
  canViewHrReports,
  hrScopeFor,
  isLineManagerOf,
  type HrEmployeeTarget
} from '@/lib/permissions/hr-access';

function employee(overrides: Partial<ActiveEmployee>): ActiveEmployee {
  return {
    id: 'self',
    clerkUserId: 'clerk_self',
    name: 'Test',
    displayName: 'Test',
    email: 'test@example.test',
    role: 'EMPLOYEE',
    team: 'alpha',
    managerId: null,
    financeAccess: false,
    hrAdmin: false,
    ...overrides
  };
}

/** A colleague on the same team who does not report to the caller. */
const colleague: HrEmployeeTarget = { id: 'colleague', managerId: 'someone-else' };
/** Someone who reports directly to the caller. */
const directReport: HrEmployeeTarget = { id: 'report', managerId: 'self' };
const ownRecord: HrEmployeeTarget = { id: 'self', managerId: 'boss' };

describe('hrScopeFor', () => {
  it('gives HR_ADMIN the whole company', () => {
    expect(hrScopeFor(employee({ role: 'HR_ADMIN' }))).toBe('all');
  });

  it('gives SECURITY_ADMIN nothing at all, not even their own record', () => {
    expect(hrScopeFor(employee({ role: 'SECURITY_ADMIN' }))).toBe('none');
  });

  it('does not widen for ADMIN — platform administration is not HR access', () => {
    expect(hrScopeFor(employee({ role: 'ADMIN' }))).toBe('reports');
  });
});

describe('isLineManagerOf', () => {
  it('matches only when the target names the caller as their manager', () => {
    const caller = employee({ id: 'self' });
    expect(isLineManagerOf(caller, directReport)).toBe(true);
    expect(isLineManagerOf(caller, colleague)).toBe(false);
  });

  it('never matches a target with no line manager set', () => {
    const caller = employee({ id: 'self' });
    expect(isLineManagerOf(caller, { id: 'x', managerId: null })).toBe(false);
  });
});

describe('canViewEmployeeRecord (employment band)', () => {
  it('lets anyone see their own record', () => {
    expect(canViewEmployeeRecord(employee({ id: 'self' }), ownRecord)).toBe(true);
  });

  it('lets a line manager see their direct report', () => {
    expect(canViewEmployeeRecord(employee({ id: 'self' }), directReport)).toBe(true);
  });

  it('does not let a TEAM_LEAD see a same-team colleague who does not report to them', () => {
    expect(canViewEmployeeRecord(employee({ id: 'self', role: 'TEAM_LEAD' }), colleague)).toBe(
      false
    );
  });

  it('does not let a MANAGER see an arbitrary colleague — team scope does not apply to HR', () => {
    expect(canViewEmployeeRecord(employee({ id: 'self', role: 'MANAGER' }), colleague)).toBe(false);
  });

  it('does not let an ADMIN see an arbitrary colleague', () => {
    expect(canViewEmployeeRecord(employee({ id: 'self', role: 'ADMIN' }), colleague)).toBe(false);
  });

  it('lets HR_ADMIN see anyone', () => {
    expect(canViewEmployeeRecord(employee({ role: 'HR_ADMIN' }), colleague)).toBe(true);
  });

  it('denies SECURITY_ADMIN even their own record', () => {
    expect(canViewEmployeeRecord(employee({ id: 'self', role: 'SECURITY_ADMIN' }), ownRecord)).toBe(
      false
    );
  });
});

describe('canViewEmployeeIdentity (date of birth, NI number, home address)', () => {
  it('lets someone see their own', () => {
    expect(canViewEmployeeIdentity(employee({ id: 'self' }), ownRecord)).toBe(true);
  });

  it('withholds it from a line manager who can already see the employment band', () => {
    const caller = employee({ id: 'self', role: 'TEAM_LEAD' });
    expect(canViewEmployeeRecord(caller, directReport)).toBe(true);
    expect(canViewEmployeeIdentity(caller, directReport)).toBe(false);
  });

  it('withholds it from a finance user', () => {
    expect(canViewEmployeeIdentity(employee({ financeAccess: true }), colleague)).toBe(false);
  });

  it('allows HR_ADMIN', () => {
    expect(canViewEmployeeIdentity(employee({ role: 'HR_ADMIN' }), colleague)).toBe(true);
  });
});

describe('canViewEmployeePay', () => {
  it('lets someone see their own pay', () => {
    expect(canViewEmployeePay(employee({ id: 'self' }), ownRecord)).toBe(true);
  });

  it('withholds a direct report’s pay from their line manager', () => {
    const caller = employee({ id: 'self', role: 'MANAGER' });
    expect(canViewEmployeeRecord(caller, directReport)).toBe(true);
    expect(canViewEmployeePay(caller, directReport)).toBe(false);
  });

  it('allows a finance user across the company', () => {
    expect(canViewEmployeePay(employee({ financeAccess: true }), colleague)).toBe(true);
  });

  it('denies SECURITY_ADMIN even with the finance flag set', () => {
    const caller = employee({ role: 'SECURITY_ADMIN', financeAccess: true });
    expect(canViewEmployeePay(caller, colleague)).toBe(false);
  });
});

describe('write access is narrower than read access', () => {
  it('does not let an employee edit their own pay even though they can read it', () => {
    const caller = employee({ id: 'self' });
    expect(canViewEmployeePay(caller, ownRecord)).toBe(true);
    expect(canEditEmployeePay(caller)).toBe(false);
  });

  it('does not let a finance user set a salary they can read', () => {
    const caller = employee({ financeAccess: true });
    expect(canViewEmployeePay(caller, colleague)).toBe(true);
    expect(canEditEmployeePay(caller)).toBe(false);
  });

  it('does not let an ADMIN edit an HR record', () => {
    expect(canEditEmployeeRecord(employee({ role: 'ADMIN' }))).toBe(false);
  });

  it('lets an employee update their own contact details', () => {
    expect(canEditOwnProfileContactDetails(employee({ id: 'self' }), ownRecord)).toBe(true);
  });

  it('does not let an employee update someone else’s contact details', () => {
    expect(canEditOwnProfileContactDetails(employee({ id: 'self' }), directReport)).toBe(false);
  });
});

describe('company-level HR capabilities', () => {
  it.each(['EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SECURITY_ADMIN'] as const)(
    'denies HR settings and HR reports to %s',
    (role) => {
      const caller = employee({ role });
      expect(canManageHrSettings(caller)).toBe(false);
      expect(canViewHrReports(caller)).toBe(false);
    }
  );

  it('allows HR_ADMIN', () => {
    const caller = employee({ role: 'HR_ADMIN' });
    expect(canManageHrSettings(caller)).toBe(true);
    expect(canViewHrReports(caller)).toBe(true);
  });

  it('allows payroll export to HR_ADMIN and finance users only', () => {
    expect(canExportPayroll(employee({ role: 'HR_ADMIN' }))).toBe(true);
    expect(canExportPayroll(employee({ financeAccess: true }))).toBe(true);
    expect(canExportPayroll(employee({ role: 'ADMIN' }))).toBe(false);
    expect(canExportPayroll(employee({ role: 'MANAGER' }))).toBe(false);
  });
});
