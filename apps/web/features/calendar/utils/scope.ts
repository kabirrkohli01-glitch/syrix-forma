import { eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { calendarEventAttendees, calendarEvents } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

// Drizzle WHERE-clause equivalent of calendar-access.ts's canViewCalendarEvent, for list/calendar
// queries that need to filter at the DB level rather than fetch everything and check row-by-row.
// Callers must gate on scope !== 'none' before querying at all (matches tasks/utils/scope.ts).
export function calendarEventScopeCondition(caller: ActiveEmployee): SQL | undefined {
  const scope = scopeForBusinessData(caller.role);
  const involvedCondition = or(
    eq(calendarEvents.createdByEmployeeId, caller.id),
    inArray(
      calendarEvents.id,
      db.select({ id: calendarEventAttendees.eventId }).from(calendarEventAttendees).where(eq(calendarEventAttendees.employeeId, caller.id))
    )
  );

  if (scope === 'all' || scope === 'cross-team') return undefined;
  if (scope === 'none') return sql`false`;
  if (scope === 'own') return involvedCondition;

  // 'team' — same-team events, plus anything the caller created or was invited to even if
  // (unusually) tagged a different team, matching canViewCalendarEvent's own involvement check.
  return caller.team ? or(eq(calendarEvents.team, caller.team), involvedCondition) : involvedCondition;
}
