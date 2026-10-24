import { describe, expect, it } from 'vitest';
import { canViewEmployeeRecord } from '@/lib/permissions/employee-access';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

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

describe('canViewEmployeeRecord', () => {
  it('always allows viewing your own record, regardless of role', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE' });
    expect(canViewEmployeeRecord(caller, { id: 'e1', team: null })).toBe(true);
  });

  it('rejects an EMPLOYEE viewing a different employee, same or different team', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'alpha' })).toBe(false);
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'beta' })).toBe(false);
  });

  it('rejects a SECURITY_ADMIN viewing another employee (scoped away from business data)', () => {
    const caller = employee({ id: 'e1', role: 'SECURITY_ADMIN', team: null });
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'alpha' })).toBe(false);
  });

  it('allows a TEAM_LEAD to view same-team, rejects a different team', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'alpha' })).toBe(true);
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'beta' })).toBe(false);
  });

  it('allows a MANAGER to view any team (cross-team scope)', () => {
    const caller = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'zzz-other' })).toBe(true);
  });

  it('allows an ADMIN to view anyone', () => {
    const caller = employee({ id: 'e1', role: 'ADMIN', team: null });
    expect(canViewEmployeeRecord(caller, { id: 'e2', team: 'beta' })).toBe(true);
  });
});
