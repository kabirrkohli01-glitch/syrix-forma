import { scopeForBusinessData } from './roles';
import type { ActiveEmployee } from './current-employee';

export type ClientTarget = { id: string; team: string };

// Client's "own" scope isn't a self-id comparison like Employee's — it's staff membership
// (is `caller` a row in client_staff for this client), which needs a DB lookup the caller has
// already done before invoking this predicate. Pass that result in explicitly rather than
// querying inside here, so this stays a pure/synchronous function like every other predicate.
export function canViewClient(
  caller: ActiveEmployee,
  target: ClientTarget,
  callerIsStaffed: boolean
): boolean {
  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  if (scope === 'own') return callerIsStaffed;

  // 'team' (TEAM_LEAD) or 'cross-team' (MANAGER)
  if (caller.role === 'MANAGER') return true;
  return caller.team !== null && caller.team === target.team;
}

export function canEditClient(
  caller: ActiveEmployee,
  target: ClientTarget,
  callerIsStaffed: boolean
): boolean {
  return canViewClient(caller, target, callerIsStaffed);
}

// Deliberately TEAM_LEAD+ only — an EMPLOYEE personally staffed on a client can view/edit it
// but should not be able to add or remove who else is staffed on it.
export function canManageClientStaff(caller: ActiveEmployee, target: ClientTarget): boolean {
  if (caller.role === 'ADMIN' || caller.role === 'MANAGER') return true;
  if (caller.role === 'TEAM_LEAD') return caller.team !== null && caller.team === target.team;
  return false;
}
