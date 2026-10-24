import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { HOME_GUIDE } from '@/config/page-guides';
import {
  addDays,
  eachDayOfInterval,
  format,
  isPast,
  isSameDay,
  isToday,
  startOfDay
} from 'date-fns';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { StaggerItem, StaggerList } from '@/components/motion/stagger-list';
import { StatCard } from '@/components/stat-card';
import {
  DashboardCustomizeTrigger,
  DashboardSection
} from '@/components/dashboard/dashboard-customize';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  DeadlineTimelineChart,
  TaskPriorityChart,
  TaskStatusChart,
  type DeadlineDayBucket,
  type TaskPrioritySlice,
  type TaskStatusSlice
} from '@/components/dashboard/workload-charts';
import { clientScopeCondition } from '@/features/clients/utils/scope';
import { enquiryScopeCondition } from '@/features/enquiries/utils/scope';
import { projectScopeCondition } from '@/features/projects/utils/scope';
import { StatusBoard } from '@/features/teams/components/status-board';
import { db } from '@/lib/db/client';
import { employeeDisplayName } from '@/lib/db/display-name';
import { TONE_CHIP_CLASSES, type Tone } from '@/lib/status-colors';
import {
  automationRuns,
  automations,
  calendarEventAttendees,
  calendarEvents,
  clients,
  documentLinks,
  employees,
  enquiries,
  integrations,
  projectMilestones,
  projects,
  tasks
} from '@/lib/db/schema';
import { canViewAutomations } from '@/lib/permissions/automation-access';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canViewIntegrations } from '@/lib/permissions/integration-access';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = {
  title: 'Home'
};

type DashboardTask = {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: Date | null;
  clientName: string | null;
  projectName: string | null;
};

const PRIORITY_DOT: Record<DashboardTask['priority'], string> = {
  urgent: 'bg-destructive',
  high: 'bg-chart-5',
  medium: 'bg-chart-2',
  low: 'bg-muted-foreground/50'
};

const PRIORITY_LABEL_TEXT: Record<DashboardTask['priority'], string> = {
  urgent: 'text-destructive',
  high: 'text-foreground',
  medium: 'text-muted-foreground',
  low: 'text-muted-foreground'
};

/** Small tone-matched dot + count, replacing a plain numeric badge in card headers. */
function CountPill({ count, tone }: { count: number; tone: Tone }) {
  return (
    <span
      className={`ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${TONE_CHIP_CLASSES[tone]}`}
    >
      {count}
    </span>
  );
}

function IconChip({
  icon: Icon,
  tone
}: {
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
}) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${TONE_CHIP_CLASSES[tone]}`}
    >
      <Icon className='size-4' />
    </span>
  );
}

/** Minimal urgency indicator — a tone-matched dot rather than a boxed badge, so a
 *  dense list of rows reads calmly instead of as a wall of colored pills. */
function PriorityMark({ priority }: { priority: DashboardTask['priority'] }) {
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-medium capitalize ${PRIORITY_LABEL_TEXT[priority]}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} aria-hidden />
      {priority}
    </span>
  );
}

function TaskRow({ task, href }: { task: DashboardTask; href: string }) {
  const context = [task.clientName, task.projectName].filter(Boolean).join(' · ');

  return (
    <Link
      href={href}
      className='hover:bg-muted/60 group/row -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150'
    >
      <div className='min-w-0'>
        <p className='group-hover/row:text-primary truncate text-sm font-medium transition-colors duration-150'>
          {task.title}
        </p>
        {context && <p className='text-muted-foreground truncate text-xs'>{context}</p>}
      </div>
      <div className='flex shrink-0 flex-col items-end gap-1'>
        {task.dueDate && (
          <span className='text-muted-foreground text-xs tabular-nums'>
            {format(task.dueDate, 'MMM d')}
          </span>
        )}
        <PriorityMark priority={task.priority} />
      </div>
    </Link>
  );
}

/* Every card in a "Needs attention" / "Your work" / "Client & document watch"
 * grid sits in a tile of the same fixed height — a list with 9 rows used to
 * render nearly three times as tall as one with a single row, so the grid
 * read as random-sized boxes rather than one set. The wrapper below reserves
 * that uniform height; the card itself is absolutely positioned inside it and
 * only grows on hover, expanding past the tile's bottom edge to reveal
 * whatever was clipped rather than shifting any other card in the grid. */
function CardSurface({
  tone,
  hasItems,
  children
}: {
  tone: Tone;
  hasItems: boolean;
  children: ReactNode;
}) {
  return (
    <div className='group relative h-72'>
      <Card
        className={`absolute inset-x-0 top-0 z-0 max-h-72 overflow-hidden shadow-sm transition-[max-height,box-shadow] duration-300 ease-out group-hover:z-30 group-hover:max-h-[34rem] group-hover:shadow-xl ${
          tone === 'destructive' && hasItems ? 'ring-destructive/20' : ''
        }`}
      >
        {children}
      </Card>
    </div>
  );
}

/** The card's header doubles as its "view all" link — clicking the title area opens
 *  the full page this card is a summary of, while rows underneath keep navigating to
 *  their own item. Nesting an <a> inside another <a> isn't valid, so only the header
 *  is a Link, not the whole card. */
function CardTitleLink({
  href,
  title,
  icon: Icon,
  tone,
  count
}: {
  href: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  count: number;
}) {
  return (
    <Link href={href} className='group/title -m-1 flex items-center gap-2.5 rounded-lg p-1'>
      <IconChip icon={Icon} tone={tone} />
      <CardTitle className='group-hover/title:text-primary flex flex-1 items-center gap-2.5 transition-colors duration-150'>
        <span className='text-[0.95rem] font-semibold'>{title}</span>
        <CountPill count={count} tone={tone} />
      </CardTitle>
      <Icons.chevronRight className='text-muted-foreground/50 group-hover/title:text-muted-foreground size-3.5 shrink-0 transition-colors duration-150' />
    </Link>
  );
}

function TaskSection({
  title,
  description,
  emptyLabel,
  taskList,
  taskHref,
  viewAllHref,
  icon,
  tone = 'neutral'
}: {
  title: string;
  description: string;
  emptyLabel: string;
  taskList: DashboardTask[];
  taskHref: (task: DashboardTask) => string;
  viewAllHref: string;
  icon: keyof typeof Icons;
  tone?: Tone;
}) {
  const Icon = Icons[icon];
  return (
    <CardSurface tone={tone} hasItems={taskList.length > 0}>
      <CardHeader>
        <CardTitleLink
          href={viewAllHref}
          title={title}
          icon={Icon}
          tone={tone}
          count={taskList.length}
        />
        <CardDescription className='pl-[calc(2rem+0.625rem)]'>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {taskList.length === 0 ? (
          <Empty className='p-4'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.checks />
              </EmptyMedia>
              <EmptyTitle>{emptyLabel}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className='divide-border/50 -my-1 divide-y'>
            {taskList.map((task) => (
              <TaskRow key={task.id} task={task} href={taskHref(task)} />
            ))}
          </div>
        )}
      </CardContent>
    </CardSurface>
  );
}

type ActionRow = { id: string; title: string; subtitle?: string; href: string; badge?: string };

function ActionListCard({
  title,
  description,
  icon,
  emptyLabel,
  rows,
  viewAllHref,
  tone = 'neutral'
}: {
  title: string;
  description: string;
  icon: keyof typeof Icons;
  emptyLabel: string;
  rows: ActionRow[];
  viewAllHref: string;
  tone?: Tone;
}) {
  const Icon = Icons[icon];
  return (
    <CardSurface tone={tone} hasItems={rows.length > 0}>
      <CardHeader>
        <CardTitleLink
          href={viewAllHref}
          title={title}
          icon={Icon}
          tone={tone}
          count={rows.length}
        />
        <CardDescription className='pl-[calc(2rem+0.625rem)]'>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{emptyLabel}</p>
        ) : (
          <ul className='divide-border/50 -my-1 divide-y'>
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={row.href}
                  className='hover:bg-muted/60 group/row -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors duration-150'
                >
                  <span className='group-hover/row:text-primary min-w-0 truncate font-medium transition-colors duration-150'>
                    {row.title}
                  </span>
                  <span className='flex shrink-0 items-center gap-2'>
                    {row.subtitle && (
                      <span className='text-muted-foreground max-w-40 truncate text-xs'>
                        {row.subtitle}
                      </span>
                    )}
                    {row.badge && (
                      <span className='text-muted-foreground text-xs font-medium tabular-nums whitespace-nowrap'>
                        {row.badge}
                      </span>
                    )}
                    <Icons.chevronRight className='text-muted-foreground/50 group-hover/row:text-muted-foreground size-3.5 shrink-0 transition-colors duration-150' />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </CardSurface>
  );
}

const DEADLINE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export default async function HomePage() {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);
  const now = new Date();
  const deadlineHorizon = new Date(now.getTime() + DEADLINE_WINDOW_MS);

  // Both scoped to the same employee and independent of each other — run in parallel rather
  // than as two sequential round trips to the database.
  const [myActiveTasks, taskStatusCountRows, teamStatusRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        clientName: clients.name,
        projectName: projects.name
      })
      .from(tasks)
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(eq(tasks.assigneeId, employee.id), ne(tasks.status, 'done'), isNull(tasks.archivedAt))
      )
      .orderBy(asc(tasks.dueDate)),
    // Every status including 'done', for the status-breakdown chart — myActiveTasks above
    // deliberately excludes 'done' since that's "what's still open," a different question.
    db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, employee.id), isNull(tasks.archivedAt)))
      .groupBy(tasks.status),
    // Same query and component as the Teams page's StatusBoard (features/teams/components/
    // status-board.tsx) — company-wide by design, not scoped to the caller's own team.
    db
      .select({
        id: employees.id,
        name: employeeDisplayName,
        team: employees.team,
        workStatus: employees.workStatus,
        workStatusChangedAt: employees.workStatusChangedAt
      })
      .from(employees)
      .where(eq(employees.status, 'active'))
  ]);

  const today = startOfDay(new Date());
  const overdue = myActiveTasks.filter(
    (t) => t.dueDate && isPast(t.dueDate) && !isToday(t.dueDate)
  );
  const upcoming = myActiveTasks.filter(
    (t) =>
      t.dueDate &&
      !overdue.includes(t) &&
      t.dueDate.getTime() - today.getTime() <= 7 * 24 * 60 * 60 * 1000
  );

  // "Unified Action Centre" (the build plan Phase 5) — every section below reuses an existing
  // scope condition or permission predicate rather than inventing new visibility rules. "Pending
  // approvals" (the bullet's own phrase) has no queue to show: Approvals in this app is inline
  // step-up re-authentication (lib/permissions/step-up.ts), not a request another person reviews
  // later — there is nothing to list, so that section is omitted rather than faked.
  const [
    clientsAwaitingResponse,
    clientsMissingDocuments,
    dueMilestoneRows,
    dueEventRows,
    automationFailureRows,
    integrationErrorRows,
    ownUpcomingEvents
  ] = await Promise.all([
    scope !== 'none'
      ? db
          .select({ id: enquiries.id, contactName: enquiries.contactName })
          .from(enquiries)
          .where(and(enquiryScopeCondition(employee), eq(enquiries.status, 'awaiting_response')))
          .limit(5)
      : Promise.resolve([]),
    scope !== 'none'
      ? db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .leftJoin(documentLinks, eq(documentLinks.clientId, clients.id))
          .where(and(clientScopeCondition(employee), eq(clients.status, 'active')))
          .groupBy(clients.id, clients.name)
          .having(sql`count(${documentLinks.id}) = 0`)
          .limit(5)
      : Promise.resolve([]),
    scope !== 'none'
      ? db
          .select({
            id: projectMilestones.id,
            title: projectMilestones.title,
            dueDate: projectMilestones.dueDate,
            projectId: projectMilestones.projectId,
            projectName: projects.name
          })
          .from(projectMilestones)
          .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
          .where(
            and(
              projectScopeCondition(employee),
              isNull(projectMilestones.completedAt),
              lte(projectMilestones.dueDate, deadlineHorizon)
            )
          )
          .limit(10)
      : Promise.resolve([]),
    scope !== 'none'
      ? db
          .select({
            id: calendarEvents.id,
            title: calendarEvents.title,
            startAt: calendarEvents.startAt,
            createdByEmployeeId: calendarEvents.createdByEmployeeId
          })
          .from(calendarEvents)
          .where(
            and(gte(calendarEvents.startAt, now), lte(calendarEvents.startAt, deadlineHorizon))
          )
          .limit(20)
      : Promise.resolve([]),
    canViewAutomations(employee)
      ? db
          .select({
            id: automationRuns.id,
            name: automations.name,
            error: automationRuns.error,
            createdAt: automationRuns.createdAt
          })
          .from(automationRuns)
          .innerJoin(automations, eq(automationRuns.automationId, automations.id))
          .where(eq(automationRuns.status, 'failed'))
          .orderBy(desc(automationRuns.createdAt))
          .limit(5)
      : Promise.resolve([]),
    canViewIntegrations(employee)
      ? db
          .select({
            id: integrations.id,
            name: integrations.name,
            lastError: integrations.lastError
          })
          .from(integrations)
          .where(eq(integrations.status, 'error'))
      : Promise.resolve([]),
    // Calendar conflicts are personal — the caller's own overlapping events, not every event
    // their role happens to have visibility into.
    db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        startAt: calendarEvents.startAt,
        endAt: calendarEvents.endAt
      })
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.startAt, now),
          lte(calendarEvents.startAt, deadlineHorizon),
          eq(calendarEvents.createdByEmployeeId, employee.id)
        )
      )
  ]);

  const attendeeEventIds = dueEventRows.map((e) => e.id);
  const involvedAsAttendee = attendeeEventIds.length
    ? await db
        .select({ eventId: calendarEventAttendees.eventId })
        .from(calendarEventAttendees)
        .where(
          and(
            inArray(calendarEventAttendees.eventId, attendeeEventIds),
            eq(calendarEventAttendees.employeeId, employee.id)
          )
        )
    : [];
  const attendeeEventIdSet = new Set(involvedAsAttendee.map((r) => r.eventId));
  const involvedEventRows = dueEventRows.filter(
    (e) => e.createdByEmployeeId === employee.id || attendeeEventIdSet.has(e.id)
  );

  const deadlineRows: ActionRow[] = [
    ...dueMilestoneRows.map((m) => ({
      id: `milestone-${m.id}`,
      title: m.title,
      subtitle: m.projectName,
      href: `/dashboard/projects/${m.projectId}`,
      badge:
        m.dueDate && isPast(m.dueDate)
          ? 'overdue'
          : m.dueDate
            ? format(m.dueDate, 'MMM d')
            : undefined
    })),
    ...involvedEventRows.map((e) => ({
      id: `event-${e.id}`,
      title: e.title,
      href: `/dashboard/calendar?month=${format(e.startAt, 'yyyy-MM')}`,
      badge: format(e.startAt, 'MMM d')
    }))
  ].slice(0, 10);

  // Deadline timeline chart: same milestone/event set as deadlineRows above, bucketed by day
  // across the full 14-day window rather than capped at 10 — the chart's job is the shape of
  // the next two weeks, not a scannable list of individual items.
  const deadlineTimelineData: DeadlineDayBucket[] = eachDayOfInterval({
    start: today,
    end: addDays(today, 13)
  }).map((day) => {
    const milestoneCount = dueMilestoneRows.filter(
      (m) => m.dueDate && isSameDay(m.dueDate, day)
    ).length;
    const eventCount = involvedEventRows.filter((e) => isSameDay(e.startAt, day)).length;
    return {
      date: format(day, 'yyyy-MM-dd'),
      label: format(day, 'MMM d'),
      count: milestoneCount + eventCount
    };
  });

  const STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'done'] as const;
  const STATUS_LABEL: Record<(typeof STATUS_ORDER)[number], string> = {
    todo: 'To do',
    in_progress: 'In progress',
    blocked: 'Blocked',
    done: 'Done'
  };
  const statusChartData: TaskStatusSlice[] = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    count: taskStatusCountRows.find((r) => r.status === status)?.count ?? 0
  }));

  const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const;
  const PRIORITY_LABEL: Record<(typeof PRIORITY_ORDER)[number], string> = {
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  };
  const priorityChartData: TaskPrioritySlice[] = PRIORITY_ORDER.map((priority) => ({
    priority,
    label: PRIORITY_LABEL[priority],
    count: myActiveTasks.filter((t) => t.priority === priority).length
  }));

  // Personal calendar conflicts: any two of the caller's own upcoming events whose time ranges
  // overlap. A small, capped list — O(n^2) is fine at this scale.
  const conflictPairs: { id: string; title: string; subtitle: string }[] = [];
  for (let i = 0; i < ownUpcomingEvents.length; i++) {
    for (let j = i + 1; j < ownUpcomingEvents.length; j++) {
      const a = ownUpcomingEvents[i];
      const b = ownUpcomingEvents[j];
      if (a.startAt < b.endAt && b.startAt < a.endAt) {
        conflictPairs.push({
          id: `${a.id}-${b.id}`,
          title: a.title,
          subtitle: `overlaps "${b.title}"`
        });
      }
    }
  }

  const attentionCount =
    overdue.length +
    conflictPairs.length +
    automationFailureRows.length +
    integrationErrorRows.length;

  const SECTION_HEADING = 'text-muted-foreground text-sm font-semibold tracking-wide uppercase';

  return (
    <PageContainer
      pageTitle={`Welcome back, ${employee.displayName.split(' ')[0]}`}
      infoContent={HOME_GUIDE}
      pageDescription='What needs your attention today.'
      pageHeaderAction={<DashboardCustomizeTrigger />}
    >
      <div className='flex flex-col gap-6'>
        <StaggerList className='grid grid-cols-2 gap-4 md:grid-cols-4'>
          <StaggerItem>
            <StatCard label='Open tasks' value={myActiveTasks.length} />
          </StaggerItem>
          <StaggerItem>
            <StatCard label='Overdue' value={overdue.length} />
          </StaggerItem>
          <StaggerItem>
            <StatCard label='Due this week' value={upcoming.length} />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label='Needs attention'
              value={attentionCount}
              sublabel='Overdue, conflicts, failures'
            />
          </StaggerItem>
        </StaggerList>

        <DashboardSection id='workload'>
          <div className='flex flex-col gap-3'>
            <h3 className={SECTION_HEADING}>Workload overview</h3>
            <StaggerList className='grid grid-cols-1 gap-4 md:grid-cols-3'>
              <StaggerItem>
                <TaskStatusChart data={statusChartData} />
              </StaggerItem>
              <StaggerItem>
                <TaskPriorityChart data={priorityChartData} />
              </StaggerItem>
              <StaggerItem>
                <DeadlineTimelineChart data={deadlineTimelineData} />
              </StaggerItem>
            </StaggerList>
          </div>
        </DashboardSection>

        <DashboardSection id='team'>
          <div className='flex flex-col gap-3'>
            <h3 className={SECTION_HEADING}>Team today</h3>
            <Card>
              <CardContent className='pt-6'>
                <StatusBoard members={teamStatusRows} />
              </CardContent>
            </Card>
          </div>
        </DashboardSection>

        <DashboardSection id='attention'>
          <div className='flex flex-col gap-3'>
            <h3 className={SECTION_HEADING}>Needs attention</h3>
            <StaggerList className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
              <StaggerItem>
                <TaskSection
                  title='Overdue'
                  description='Past their due date and still open.'
                  emptyLabel='Nothing overdue'
                  taskList={overdue}
                  taskHref={(task) => `/dashboard/my-work/${task.id}`}
                  viewAllHref='/dashboard/my-work'
                  icon='warning'
                  tone='destructive'
                />
              </StaggerItem>
              <StaggerItem>
                <ActionListCard
                  title='Calendar conflicts'
                  description='Your own meetings that overlap each other.'
                  icon='calendar'
                  emptyLabel='No overlapping meetings'
                  rows={conflictPairs.map((c) => ({
                    id: c.id,
                    title: c.title,
                    subtitle: c.subtitle,
                    href: '/dashboard/calendar'
                  }))}
                  viewAllHref='/dashboard/calendar'
                  tone='destructive'
                />
              </StaggerItem>
              {canViewAutomations(employee) && (
                <StaggerItem>
                  <ActionListCard
                    title='Automation failures'
                    description='Failed runs, most recent first.'
                    icon='automation'
                    emptyLabel='No recent failures'
                    rows={automationFailureRows.map((r) => ({
                      id: r.id,
                      title: r.name,
                      subtitle: r.error ?? undefined,
                      href: '/dashboard/automations'
                    }))}
                    viewAllHref='/dashboard/automations'
                    tone='destructive'
                  />
                </StaggerItem>
              )}
              {canViewIntegrations(employee) && (
                <StaggerItem>
                  <ActionListCard
                    title='Integration errors'
                    description='Integrations currently in an error state.'
                    icon='integrationError'
                    emptyLabel='Every integration is healthy'
                    rows={integrationErrorRows.map((r) => ({
                      id: r.id,
                      title: r.name,
                      subtitle: r.lastError ?? undefined,
                      href: '/dashboard/settings/integrations'
                    }))}
                    viewAllHref='/dashboard/settings/integrations'
                    tone='destructive'
                  />
                </StaggerItem>
              )}
            </StaggerList>
          </div>
        </DashboardSection>

        <DashboardSection id='work'>
          <div className='flex flex-col gap-3'>
            <h3 className={SECTION_HEADING}>Your work</h3>
            <StaggerList className='grid grid-cols-1 gap-4 md:grid-cols-3'>
              <StaggerItem>
                <TaskSection
                  title='My Tasks'
                  description="Everything assigned to you that isn't done yet."
                  emptyLabel='Nothing on your plate right now'
                  taskList={myActiveTasks}
                  taskHref={(task) => `/dashboard/my-work/${task.id}`}
                  viewAllHref='/dashboard/my-work'
                  icon='checks'
                  tone='neutral'
                />
              </StaggerItem>
              <StaggerItem>
                <TaskSection
                  title='Upcoming'
                  description='Due within the next 7 days.'
                  emptyLabel='Nothing due soon'
                  taskList={upcoming}
                  taskHref={(task) => `/dashboard/my-work/${task.id}`}
                  viewAllHref='/dashboard/my-work'
                  icon='clock'
                  tone='caution'
                />
              </StaggerItem>
              <StaggerItem>
                <ActionListCard
                  title='Deadlines'
                  description='Milestones and meetings in the next 14 days.'
                  icon='clock'
                  emptyLabel='Nothing coming up'
                  rows={deadlineRows}
                  viewAllHref='/dashboard/calendar'
                  tone='caution'
                />
              </StaggerItem>
            </StaggerList>
          </div>
        </DashboardSection>

        <DashboardSection id='watch'>
          <div className='flex flex-col gap-3'>
            <h3 className={SECTION_HEADING}>Client &amp; document watch</h3>
            <StaggerList className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <StaggerItem>
                <ActionListCard
                  title='Clients awaiting response'
                  description='Enquiries left in that state.'
                  icon='chat'
                  emptyLabel='Nothing waiting'
                  rows={clientsAwaitingResponse.map((e) => ({
                    id: e.id,
                    title: e.contactName,
                    href: '/dashboard/automations'
                  }))}
                  viewAllHref='/dashboard/automations'
                  tone='info'
                />
              </StaggerItem>
              <StaggerItem>
                <ActionListCard
                  title='Missing documents'
                  description='Active clients with no linked reference documents.'
                  icon='paperclip'
                  emptyLabel='Every client has at least one document linked'
                  rows={clientsMissingDocuments.map((c) => ({
                    id: c.id,
                    title: c.name,
                    href: `/dashboard/clients/${c.id}`
                  }))}
                  viewAllHref='/dashboard/clients'
                  tone='info'
                />
              </StaggerItem>
            </StaggerList>
          </div>
        </DashboardSection>
      </div>
    </PageContainer>
  );
}
