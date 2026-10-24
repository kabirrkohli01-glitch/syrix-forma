import { scopeForBusinessData } from './roles';
import type { ActiveEmployee } from './current-employee';

export type EnquiryTarget = { id: string; team: string };

// Unlike Task, an Enquiry has no assignee field for "own" to mean "assigned to me" via — so
// EMPLOYEE's 'own' scope collapses to the same team-column comparison TEAM_LEAD's 'team' scope
// uses (docs/permissions-matrix.md: EMPLOYEE sees "own team", not just enquiries it created).
export function canViewEnquiry(caller: ActiveEmployee, target: EnquiryTarget): boolean {
  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  if (scope === 'own' || scope === 'team') {
    return caller.team !== null && caller.team === target.team;
  }
  // 'cross-team' (MANAGER)
  return true;
}

// Kept as its own export rather than an alias, same reasoning as Task's canEditTask: a future
// approval/step-up workflow may need to split view/edit even though they agree today.
export function canEditEnquiry(caller: ActiveEmployee, target: EnquiryTarget): boolean {
  return canViewEnquiry(caller, target);
}

export function canCreateEnquiry(caller: ActiveEmployee): boolean {
  return scopeForBusinessData(caller.role) !== 'none';
}
