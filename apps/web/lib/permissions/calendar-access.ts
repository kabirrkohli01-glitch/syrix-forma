import { scopeForBusinessData } from './roles';
import type { ActiveEmployee } from './current-employee';

export type CalendarEventTarget = { id: string; team: string };

// An event's "own" scope isn't a single assignee like Task — it's creator-or-attendee, the same
// shape as Client/Project's "own" being staff membership. That lookup happens before this
// predicate is called (features/calendar/actions.ts), passed in as a plain boolean so this stays
// a pure/synchronous function like every other predicate in this directory.
export function canViewCalendarEvent(
  caller: ActiveEmployee,
  target: CalendarEventTarget,
  callerIsInvolved: boolean
): boolean {
  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all') return true;
  if (scope === 'none') return false;
  if (scope === 'own') return callerIsInvolved;

  // 'team' (TEAM_LEAD) or 'cross-team' (MANAGER)
  if (caller.role === 'MANAGER') return true;
  return callerIsInvolved || (caller.team !== null && caller.team === target.team);
}

export function canEditCalendarEvent(
  caller: ActiveEmployee,
  target: CalendarEventTarget,
  callerIsInvolved: boolean
): boolean {
  return canViewCalendarEvent(caller, target, callerIsInvolved);
}
