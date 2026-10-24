import { describe, expect, it } from 'vitest';
import {
  canManageProjectStaff,
  canViewProject,
  canEditProject
} from '@/lib/permissions/project-access';
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

describe('canViewProject', () => {
  it('allows an EMPLOYEE staffed on the project, rejects one who is not', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewProject(caller, { id: 'p1', team: 'alpha' }, true)).toBe(true);
    expect(canViewProject(caller, { id: 'p1', team: 'alpha' }, false)).toBe(false);
  });

  it('rejects a SECURITY_ADMIN viewing any project (scoped away from business data)', () => {
    const caller = employee({ id: 'e1', role: 'SECURITY_ADMIN', team: null });
    expect(canViewProject(caller, { id: 'p1', team: 'alpha' }, false)).toBe(false);
  });

  it('allows a TEAM_LEAD to view a same-team project without being staffed, rejects a different team', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canViewProject(caller, { id: 'p1', team: 'alpha' }, false)).toBe(true);
    expect(canViewProject(caller, { id: 'p1', team: 'beta' }, false)).toBe(false);
  });

  it("allows a MANAGER to view any team's project (cross-team scope)", () => {
    const caller = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    expect(canViewProject(caller, { id: 'p1', team: 'zzz-other' }, false)).toBe(true);
  });

  it('allows an ADMIN to view any project', () => {
    const caller = employee({ id: 'e1', role: 'ADMIN', team: null });
    expect(canViewProject(caller, { id: 'p1', team: 'beta' }, false)).toBe(true);
  });
});

describe('canEditProject', () => {
  it("matches canViewProject's scoping", () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canEditProject(caller, { id: 'p1', team: 'alpha' }, true)).toBe(true);
    expect(canEditProject(caller, { id: 'p1', team: 'alpha' }, false)).toBe(false);
  });
});

describe('canManageProjectStaff', () => {
  it('rejects an EMPLOYEE even if personally staffed on the project', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canManageProjectStaff(caller, { id: 'p1', team: 'alpha' })).toBe(false);
  });

  it('allows a TEAM_LEAD to manage staff on a same-team project, rejects a different team', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canManageProjectStaff(caller, { id: 'p1', team: 'alpha' })).toBe(true);
    expect(canManageProjectStaff(caller, { id: 'p1', team: 'beta' })).toBe(false);
  });

  it('allows a MANAGER or ADMIN to manage staff on any project', () => {
    const manager = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    const admin = employee({ id: 'e2', role: 'ADMIN', team: null });
    expect(canManageProjectStaff(manager, { id: 'p1', team: 'beta' })).toBe(true);
    expect(canManageProjectStaff(admin, { id: 'p1', team: 'beta' })).toBe(true);
  });
});
