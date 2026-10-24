import { describe, expect, it } from 'vitest';
import {
  canManageClientStaff,
  canViewClient,
  canEditClient
} from '@/lib/permissions/client-access';
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

describe('canViewClient', () => {
  it('allows an EMPLOYEE staffed on the client, rejects one who is not', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewClient(caller, { id: 'c1', team: 'alpha' }, true)).toBe(true);
    expect(canViewClient(caller, { id: 'c1', team: 'alpha' }, false)).toBe(false);
  });

  it("trusts the caller-supplied staffed flag over the client's team, for EMPLOYEE scope", () => {
    // EMPLOYEE's scope is 'own' (staff-membership-based), not team-based — a staffed employee
    // on a different-team client should still see it, since the predicate never re-derives
    // team for 'own' scope, it only consults `callerIsStaffed`.
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewClient(caller, { id: 'c1', team: 'beta' }, true)).toBe(true);
  });

  it('rejects a SECURITY_ADMIN viewing any client (scoped away from business data)', () => {
    const caller = employee({ id: 'e1', role: 'SECURITY_ADMIN', team: null });
    expect(canViewClient(caller, { id: 'c1', team: 'alpha' }, false)).toBe(false);
  });

  it('allows a TEAM_LEAD to view a same-team client without being staffed, rejects a different team', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canViewClient(caller, { id: 'c1', team: 'alpha' }, false)).toBe(true);
    expect(canViewClient(caller, { id: 'c1', team: 'beta' }, false)).toBe(false);
  });

  it("allows a MANAGER to view any team's client (cross-team scope)", () => {
    const caller = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    expect(canViewClient(caller, { id: 'c1', team: 'zzz-other' }, false)).toBe(true);
  });

  it('allows an ADMIN to view any client', () => {
    const caller = employee({ id: 'e1', role: 'ADMIN', team: null });
    expect(canViewClient(caller, { id: 'c1', team: 'beta' }, false)).toBe(true);
  });
});

describe('canEditClient', () => {
  it("matches canViewClient's scoping", () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canEditClient(caller, { id: 'c1', team: 'alpha' }, true)).toBe(true);
    expect(canEditClient(caller, { id: 'c1', team: 'alpha' }, false)).toBe(false);
  });
});

describe('canManageClientStaff', () => {
  it('rejects an EMPLOYEE even if personally staffed on the client', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canManageClientStaff(caller, { id: 'c1', team: 'alpha' })).toBe(false);
  });

  it('allows a TEAM_LEAD to manage staff on a same-team client, rejects a different team', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canManageClientStaff(caller, { id: 'c1', team: 'alpha' })).toBe(true);
    expect(canManageClientStaff(caller, { id: 'c1', team: 'beta' })).toBe(false);
  });

  it('allows a MANAGER or ADMIN to manage staff on any client', () => {
    const manager = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    const admin = employee({ id: 'e2', role: 'ADMIN', team: null });
    expect(canManageClientStaff(manager, { id: 'c1', team: 'beta' })).toBe(true);
    expect(canManageClientStaff(admin, { id: 'c1', team: 'beta' })).toBe(true);
  });
});
