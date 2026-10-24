import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { format } from 'date-fns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { StatusBadge } from '@/components/ui/status-badge';
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from '@/lib/status-colors';
import { ScheduleMeetingButton } from '@/features/calendar/components/schedule-meeting-button';
import { ClientNotesCard } from '@/features/clients/components/client-notes-card';
import { ClientStaffManager } from '@/features/clients/components/client-staff-manager';
import { EditClientDialog } from '@/features/clients/components/edit-client-dialog';
import { DocumentLinksCard } from '@/features/document-links/components/document-links-card';
import { db } from '@/lib/db/client';
import {
  auditLog,
  calendarEventAttendees,
  calendarEvents,
  clientNotes,
  clientStaff,
  clients,
  documentLinks,
  emailActivity,
  employees,
  projectStaff,
  projects,
  tasks
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { canViewCalendarEvent } from '@/lib/permissions/calendar-access';
import {
  canEditClient,
  canManageClientStaff,
  canViewClient
} from '@/lib/permissions/client-access';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canViewProject } from '@/lib/permissions/project-access';
import { canViewTask } from '@/lib/permissions/task-access';

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  return { title: client?.name ?? 'Client' };
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await requireActiveEmployeeForPage();

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) notFound();

  const [staffRow] = await db
    .select({ id: clientStaff.id })
    .from(clientStaff)
    .where(and(eq(clientStaff.clientId, id), eq(clientStaff.employeeId, employee.id)))
    .limit(1);
  const isStaffed = !!staffRow;

  if (!canViewClient(employee, { id: client.id, team: client.team }, isStaffed)) notFound();

  const canManageStaff = canManageClientStaff(employee, { id: client.id, team: client.team });
  const canEdit = canEditClient(employee, { id: client.id, team: client.team }, isStaffed);

  const [
    staffedEmployees,
    allActiveEmployees,
    linkedTasks,
    linkedProjects,
    activity,
    linkedDocuments,
    linkedMeetingRows,
    linkedEmails,
    noteRows
  ] = await Promise.all([
    db
      .select({ id: employees.id, name: employeeDisplayName })
      .from(clientStaff)
      .innerJoin(employees, eq(clientStaff.employeeId, employees.id))
      .where(eq(clientStaff.clientId, id)),
    db
      .select({ id: employees.id, name: employeeDisplayName })
      .from(employees)
      .where(eq(employees.status, 'active')),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        assigneeId: tasks.assigneeId,
        team: tasks.team
      })
      .from(tasks)
      .where(and(eq(tasks.clientId, id), isNull(tasks.archivedAt))),
    db.select().from(projects).where(eq(projects.clientId, id)),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.resourceType, 'client'), eq(auditLog.resourceId, id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(20),
    db.select().from(documentLinks).where(eq(documentLinks.clientId, id)),
    db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        startAt: calendarEvents.startAt,
        endAt: calendarEvents.endAt,
        allDay: calendarEvents.allDay,
        team: calendarEvents.team,
        createdByEmployeeId: calendarEvents.createdByEmployeeId
      })
      .from(calendarEvents)
      .where(eq(calendarEvents.clientId, id)),
    db
      .select()
      .from(emailActivity)
      .where(eq(emailActivity.clientId, id))
      .orderBy(desc(emailActivity.occurredAt))
      .limit(20),
    db
      .select({
        id: clientNotes.id,
        body: clientNotes.body,
        authorEmployeeId: clientNotes.authorEmployeeId,
        authorName: employeeDisplayName,
        createdAt: clientNotes.createdAt
      })
      .from(clientNotes)
      .leftJoin(employees, eq(clientNotes.authorEmployeeId, employees.id))
      .where(eq(clientNotes.clientId, id))
      .orderBy(desc(clientNotes.createdAt))
  ]);

  // Task's own/team scoping can be stricter than the Client's — a caller who can see this
  // client (e.g. staffed on it) may not be able to see every task linked to it (e.g. one
  // assigned to someone on a different team). Filter per row rather than trust the client-level
  // gate above to cover it.
  const visibleTasks = linkedTasks.filter((task) => canViewTask(employee, task));

  // Same idea for meetings — a calendar event's own creator-or-attendee scope can be stricter
  // (or, for an invited outsider, looser) than the client's.
  const meetingIds = linkedMeetingRows.map((m) => m.id);
  const meetingAttendeeRows = meetingIds.length
    ? await db
        .select({
          eventId: calendarEventAttendees.eventId,
          employeeId: calendarEventAttendees.employeeId
        })
        .from(calendarEventAttendees)
        .where(inArray(calendarEventAttendees.eventId, meetingIds))
    : [];
  const attendeesByMeeting = new Map<string, string[]>();
  for (const row of meetingAttendeeRows) {
    attendeesByMeeting.set(row.eventId, [
      ...(attendeesByMeeting.get(row.eventId) ?? []),
      row.employeeId
    ]);
  }
  const visibleMeetings = linkedMeetingRows
    .filter((meeting) => {
      const involved =
        meeting.createdByEmployeeId === employee.id ||
        (attendeesByMeeting.get(meeting.id) ?? []).includes(employee.id);
      return canViewCalendarEvent(employee, meeting, involved);
    })
    .toSorted((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const projectStaffRows = linkedProjects.length
    ? await db
        .select({ projectId: projectStaff.projectId })
        .from(projectStaff)
        .where(
          and(
            inArray(
              projectStaff.projectId,
              linkedProjects.map((p) => p.id)
            ),
            eq(projectStaff.employeeId, employee.id)
          )
        )
    : [];
  const staffedProjectIds = new Set(projectStaffRows.map((r) => r.projectId));
  const visibleProjects = linkedProjects.filter((project) =>
    canViewProject(
      employee,
      { id: project.id, team: project.team },
      staffedProjectIds.has(project.id)
    )
  );

  const addableEmployees = allActiveEmployees.filter(
    (candidate) => !staffedEmployees.some((s) => s.id === candidate.id)
  );

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:px-6'>
      <Card>
        <CardHeader>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-start gap-3'>
              <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
                <Icons.teams className='size-4' />
              </span>
              <div>
                <CardTitle>{client.name}</CardTitle>
                <CardDescription>{client.serviceLine ?? 'No service line set'}</CardDescription>
              </div>
            </div>
            {canEdit && (
              <EditClientDialog
                clientId={client.id}
                currentName={client.name}
                currentServiceLine={client.serviceLine}
                currentStatus={client.status}
                currentTeam={client.team}
                canChangeTeam={employee.role === 'ADMIN'}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className='flex gap-2'>
          <Badge variant='outline'>{client.team}</Badge>
          <StatusBadge tone={CLIENT_STATUS_TONE[client.status]}>
            {CLIENT_STATUS_LABEL[client.status]}
          </StatusBadge>
        </CardContent>
      </Card>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Assigned Staff</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientStaffManager
              clientId={client.id}
              staffed={staffedEmployees}
              addableEmployees={addableEmployees}
              canManage={canManageStaff}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {visibleProjects.length === 0 ? (
              <p className='text-muted-foreground text-sm'>No projects linked yet.</p>
            ) : (
              <ul className='flex flex-col gap-2'>
                {visibleProjects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className='text-sm font-medium hover:underline'
                    >
                      {project.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientNotesCard
            clientId={client.id}
            notes={noteRows.map((note) => ({
              ...note,
              authorName: note.authorName ?? 'Former employee'
            }))}
            currentEmployeeId={employee.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {visibleTasks.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.checks />
                </EmptyMedia>
                <EmptyTitle>No tasks linked yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className='flex flex-col gap-2'>
              {visibleTasks.map((task) => (
                <li key={task.id} className='flex items-center justify-between text-sm'>
                  <span>{task.title}</span>
                  <div className='flex items-center gap-2'>
                    {task.dueDate && (
                      <span className='text-muted-foreground text-xs'>
                        Due {format(task.dueDate, 'MMM d, yyyy')}
                      </span>
                    )}
                    <Badge variant='outline'>{task.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-center justify-between gap-4'>
            <div>
              <CardTitle>Meetings</CardTitle>
              <CardDescription>Upcoming and past meetings linked to this client.</CardDescription>
            </div>
            <ScheduleMeetingButton
              defaultClientId={client.id}
              clientOptions={[]}
              employeeOptions={staffedEmployees}
              projectOptions={visibleProjects.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
        </CardHeader>
        <CardContent>
          {visibleMeetings.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No meetings linked yet.</p>
          ) : (
            <ul className='flex flex-col gap-2'>
              {visibleMeetings.map((meeting) => (
                <li key={meeting.id} className='flex items-center justify-between gap-2 text-sm'>
                  <Link
                    href={`/dashboard/calendar?month=${format(meeting.startAt, 'yyyy-MM')}`}
                    className='min-w-0 truncate hover:underline'
                  >
                    {meeting.title}
                  </Link>
                  <span className='text-muted-foreground shrink-0 text-xs'>
                    {meeting.allDay
                      ? format(meeting.startAt, 'MMM d, yyyy')
                      : format(meeting.startAt, 'MMM d, yyyy HH:mm')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emails</CardTitle>
          <CardDescription>Recent email activity linked to this client.</CardDescription>
        </CardHeader>
        <CardContent>
          {linkedEmails.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No linked email activity yet.</p>
          ) : (
            <ul className='flex flex-col gap-2'>
              {linkedEmails.map((mail) => (
                <li key={mail.id} className='flex items-center justify-between gap-2 text-sm'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <Badge variant='outline' className='capitalize'>
                      {mail.direction}
                    </Badge>
                    <span className='truncate'>{mail.subject ?? '(no subject)'}</span>
                  </div>
                  <span className='text-muted-foreground shrink-0 text-xs'>
                    {format(mail.occurredAt, 'MMM d, yyyy HH:mm')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Reference-only links — SYRIX Forma never stores the file itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentLinksCard
            clientId={client.id}
            canManage={canEdit}
            links={linkedDocuments.map((link) => ({
              id: link.id,
              label: link.label,
              url: link.url,
              system: link.system,
              lastCheckStatus: link.lastCheckStatus,
              lastCheckedAt: link.lastCheckedAt
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Recent actions recorded against this client.</CardDescription>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No activity yet.</p>
          ) : (
            <ul className='flex flex-col gap-2'>
              {activity.map((entry) => (
                <li key={entry.id} className='flex items-center justify-between text-sm'>
                  <span className='capitalize'>{entry.action.replace(/_/g, ' ')}</span>
                  <span className='text-muted-foreground text-xs'>
                    {format(entry.createdAt, 'MMM d, yyyy HH:mm')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
