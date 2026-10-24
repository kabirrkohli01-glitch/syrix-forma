import { canAssignWithinTeam, scopeForBusinessData } from './roles';
import type { ActiveEmployee } from './current-employee';

// Unlike Employee's own-record check (caller.id === target.id), a Task's "own" scope means
// "assigned to me" — a task's id is never the caller's id. `team` is the task's own team
// (tasks.team), independent of who it's currently assigned to — see schema.ts's comment on
// that column for why: assigneeId is null until someone picks up a task, so scoping by the
// assignee's team alone would make an unassigned task invisible to the team meant to work it.
export type TaskTarget = { id: string; assigneeId: string | null; team: string };

export function canViewTask(caller: ActiveEmployee, target: TaskTarget): boolean {
  if (caller.id === target.assigneeId) return true;

  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all') return true;
  if (scope === 'none' || scope === 'own') return false;

  // 'team' (TEAM_LEAD) or 'cross-team' (MANAGER)
  if (caller.role === 'MANAGER') return true;
  return caller.team !== null && caller.team === target.team;
}

// Kept as its own export rather than an alias of canViewTask: Phase 5's approval workflow is
// expected to split view/edit for Task (e.g. a step-up-auth requirement on edits that view
// doesn't need), so don't merge these into one function now just because they agree today.
export function canEditTask(caller: ActiveEmployee, target: TaskTarget): boolean {
  return canViewTask(caller, target);
}

// Whether `caller` may (re)assign this task to the employee on `newAssigneeTeam`. Requires
// being able to see the task at all, an assign-capable role, and — for TEAM_LEAD specifically —
// that the *new* assignee is on the caller's own team.
export function canAssignTask(
  caller: ActiveEmployee,
  target: TaskTarget,
  newAssigneeTeam: string | null
): boolean {
  if (!canViewTask(caller, target)) return false;
  if (caller.role === 'ADMIN') return true;
  if (!canAssignWithinTeam(caller.role)) return false;
  if (caller.role === 'MANAGER') return true;
  return caller.team !== null && caller.team === newAssigneeTeam;
}
