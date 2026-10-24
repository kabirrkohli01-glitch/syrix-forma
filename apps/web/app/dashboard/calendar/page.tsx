import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { CALENDAR_GUIDE } from '@/config/page-guides';
import { endOfMonth, endOfWeek, isValid, parse, startOfMonth, startOfWeek } from 'date-fns';
import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { ConnectProviderDialog } from '@/features/calendar/components/connect-provider-dialog';
import { EventCalendar } from '@/features/calendar/components/event-calendar';
import { calendarEventScopeCondition } from '@/features/calendar/utils/scope';
import { db } from '@/lib/db/client';
import { calendarEventAttendees, calendarEvents, clients, employees, projects } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { canEditCalendarEvent } from '@/lib/permissions/calendar-access';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Calendar' access={false}>
        {null}
      </PageContainer>
    );
  }

  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const parsedMonth = monthParam ? parse(monthParam, 'yyyy-MM', new Date()) : new Date();
  const month = isValid(parsedMonth) ? parsedMonth : new Date();

  // Padded to the visible grid (leading/trailing days from adjacent months), not just the
  // calendar month itself.
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const eventRows = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      description: calendarEvents.description,
      location: calendarEvents.location,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      team: calendarEvents.team,
      createdByEmployeeId: calendarEvents.createdByEmployeeId,
      clientId: calendarEvents.clientId,
      projectId: calendarEvents.projectId
    })
    .from(calendarEvents)
    .where(
      and(calendarEventScopeCondition(employee), gte(calendarEvents.startAt, gridStart), lte(calendarEvents.startAt, gridEnd))
    );

  const eventIds = eventRows.map((e) => e.id);
  const attendeeRows = eventIds.length
    ? await db
        .select({ eventId: calendarEventAttendees.eventId, employeeId: calendarEventAttendees.employeeId })
        .from(calendarEventAttendees)
        .where(inArray(calendarEventAttendees.eventId, eventIds))
    : [];
  const attendeesByEvent = new Map<string, string[]>();
  for (const row of attendeeRows) {
    attendeesByEvent.set(row.eventId, [...(attendeesByEvent.get(row.eventId) ?? []), row.employeeId]);
  }

  const events = eventRows.map((event) => {
    const attendeeIds = attendeesByEvent.get(event.id) ?? [];
    const involved = event.createdByEmployeeId === employee.id || attendeeIds.includes(employee.id);
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      clientId: event.clientId,
      projectId: event.projectId,
      attendeeIds,
      canManage: canEditCalendarEvent(employee, { id: event.id, team: event.team }, involved)
    };
  });

  // Same scoping as My Work's assignee picker — who this caller may add as an attendee.
  const employeeCondition =
    scope === 'all' || scope === 'cross-team'
      ? eq(employees.status, 'active')
      : scope === 'team' && employee.team
        ? and(eq(employees.status, 'active'), eq(employees.team, employee.team))
        : and(eq(employees.status, 'active'), eq(employees.id, employee.id));

  const [employeeOptions, clientOptions, projectOptions] = await Promise.all([
    db.select({ id: employees.id, name: employeeDisplayName }).from(employees).where(employeeCondition),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.status, 'active')),
    db.select({ id: projects.id, name: projects.name }).from(projects)
  ]);

  return (
    <PageContainer
      pageTitle='Calendar'
      infoContent={CALENDAR_GUIDE}
      pageDescription='Meetings, appointments, and deadlines — works fully on its own, no external account required.'
      pageHeaderAction={
        // Two buttons with labels this long do not share a line on a small phone.
        <div className='flex flex-wrap items-center gap-2'>
          <ConnectProviderDialog provider='Google' />
          <ConnectProviderDialog provider='Outlook' />
        </div>
      }
    >
      <EventCalendar
        events={events}
        month={month}
        employeeOptions={employeeOptions}
        clientOptions={clientOptions}
        projectOptions={projectOptions}
      />
    </PageContainer>
  );
}
