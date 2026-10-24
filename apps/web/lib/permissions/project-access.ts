import { scopeForBusinessData } from './roles';
import type { ActiveEmployee } from './current-employee';

export type ProjectTarget = { id: string; team: string };

// Same shape as client-access.ts's canViewClient — Project's "own" scope is project_staff
// membership, checked by the caller before invoking this predicate. See that file's header
// comment for why the DB lookup happens outside a pure predicate.
export function canViewProject(
  caller: ActiveEmployee,
  target: ProjectTarget,
  callerIsStaffed: boolean
): boolean {
  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  if (scope === 'own') return callerIsStaffed;

  if (caller.role === 'MANAGER') return true;
  return caller.team !== null && caller.team === target.team;
}

export function canEditProject(
  caller: ActiveEmployee,
  target: ProjectTarget,
  callerIsStaffed: boolean
): boolean {
  return canViewProject(caller, target, callerIsStaffed);
}

export function canManageProjectStaff(caller: ActiveEmployee, target: ProjectTarget): boolean {
  if (caller.role === 'ADMIN' || caller.role === 'MANAGER') return true;
  if (caller.role === 'TEAM_LEAD') return caller.team !== null && caller.team === target.team;
  return false;
}
