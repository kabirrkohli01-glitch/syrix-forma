import { describe, expect, it } from 'vitest';
import { canAssignTask, canEditTask, canViewTask } from '@/lib/permissions/task-access';
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

describe('canViewTask', () => {
  it('always allows the assignee to view their own task, regardless of role or team', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e1', team: 'beta' })).toBe(true);
  });

  it('rejects an EMPLOYEE viewing a task assigned to someone else, same or different team', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'alpha' })).toBe(false);
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'beta' })).toBe(false);
  });

  it('rejects an EMPLOYEE viewing an unassigned same-team task', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewTask(caller, { id: 't1', assigneeId: null, team: 'alpha' })).toBe(false);
  });

  it("rejects a SECURITY_ADMIN viewing someone else's task (scoped away from business data)", () => {
    const caller = employee({ id: 'e1', role: 'SECURITY_ADMIN', team: null });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'alpha' })).toBe(false);
  });

  it('allows a TEAM_LEAD to view a same-team task, including an unassigned one', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'alpha' })).toBe(true);
    expect(canViewTask(caller, { id: 't1', assigneeId: null, team: 'alpha' })).toBe(true);
  });

  it('rejects a TEAM_LEAD viewing a different-team task, even if assigned to no one', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'beta' })).toBe(false);
    expect(canViewTask(caller, { id: 't1', assigneeId: null, team: 'beta' })).toBe(false);
  });

  it("allows a MANAGER to view any team's task, including unassigned (cross-team scope)", () => {
    const caller = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'zzz-other' })).toBe(true);
    expect(canViewTask(caller, { id: 't1', assigneeId: null, team: 'zzz-other' })).toBe(true);
  });

  it('allows an ADMIN to view any task, including unassigned', () => {
    const caller = employee({ id: 'e1', role: 'ADMIN', team: null });
    expect(canViewTask(caller, { id: 't1', assigneeId: 'e2', team: 'beta' })).toBe(true);
    expect(canViewTask(caller, { id: 't1', assigneeId: null, team: 'beta' })).toBe(true);
  });
});

describe('canEditTask', () => {
  it("matches canViewTask's scoping", () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canEditTask(caller, { id: 't1', assigneeId: 'e2', team: 'alpha' })).toBe(true);
    expect(canEditTask(caller, { id: 't1', assigneeId: 'e2', team: 'beta' })).toBe(false);
  });
});

describe('canAssignTask', () => {
  it('rejects an EMPLOYEE from assigning, even their own task', () => {
    const caller = employee({ id: 'e1', role: 'EMPLOYEE', team: 'alpha' });
    expect(canAssignTask(caller, { id: 't1', assigneeId: 'e1', team: 'alpha' }, 'alpha')).toBe(
      false
    );
  });

  it('allows a TEAM_LEAD to assign within their own team, including a previously-unassigned task', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canAssignTask(caller, { id: 't1', assigneeId: null, team: 'alpha' }, 'alpha')).toBe(
      true
    );
  });

  it('rejects a TEAM_LEAD assigning to a different team than the new assignee is on', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canAssignTask(caller, { id: 't1', assigneeId: 'e2', team: 'alpha' }, 'beta')).toBe(
      false
    );
  });

  it('rejects a TEAM_LEAD assigning a task they cannot even view (different team)', () => {
    const caller = employee({ id: 'e1', role: 'TEAM_LEAD', team: 'alpha' });
    expect(canAssignTask(caller, { id: 't1', assigneeId: 'e2', team: 'beta' }, 'alpha')).toBe(
      false
    );
  });

  it('allows a MANAGER to assign across teams', () => {
    const caller = employee({ id: 'e1', role: 'MANAGER', team: 'alpha' });
    expect(canAssignTask(caller, { id: 't1', assigneeId: 'e2', team: 'beta' }, 'gamma')).toBe(true);
  });

  it('allows an ADMIN to assign anything anywhere', () => {
    const caller = employee({ id: 'e1', role: 'ADMIN', team: null });
    expect(canAssignTask(caller, { id: 't1', assigneeId: null, team: 'beta' }, 'zzz-other')).toBe(
      true
    );
  });
});
