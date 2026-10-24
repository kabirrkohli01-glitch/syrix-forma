import { and, asc, count, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { MY_WORK_GUIDE } from '@/config/page-guides';
import { isValid, parse } from 'date-fns';
import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { CreateTaskDialog } from '@/features/tasks/components/create-task-dialog';
import { MyDayView } from '@/features/tasks/components/my-day-view';
import { TaskBoard } from '@/features/tasks/components/task-board';
import { TaskCalendar } from '@/features/tasks/components/task-calendar';
import { TaskTimeline } from '@/features/tasks/components/task-timeline';
import { TasksTable } from '@/features/tasks/components/tasks-table';
import { TaskViewToggle } from '@/features/tasks/components/task-view-toggle';
import { taskScopeCondition } from '@/features/tasks/utils/scope';
import { TASK_VIEW_VALUES, type TaskView } from '@/features/tasks/utils/task-view';
import { db } from '@/lib/db/client';
import { clients, employees, projects, taskPriorityEnum, taskStatusEnum, tasks } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'My Work' };

function parseListParam<T extends string>(
  value: string | string[] | undefined,
  validValues: readonly T[]
): T[] | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : value;
  const parts = raw.split(',').filter((v): v is T => (validValues as readonly string[]).includes(v));
  return parts.length > 0 ? parts : undefined;
}

const SORTABLE_COLUMNS = {
  title: tasks.title,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate
} as const;

export default async function MyWorkPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='My Work' access={false}>
        {null}
      </PageContainer>
    );
  }

  const params = await searchParams;
  const viewParam = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: TaskView = (TASK_VIEW_VALUES as readonly string[]).includes(viewParam ?? '')
    ? (viewParam as TaskView)
    : 'list';
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const parsedMonth = monthParam ? parse(monthParam, 'yyyy-MM', new Date()) : new Date();
  const month = isValid(parsedMonth) ? parsedMonth : new Date();
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.perPage) || 10));
  const statusFilter = parseListParam(params.status, taskStatusEnum.enumValues);
  const priorityFilter = parseListParam(params.priority, taskPriorityEnum.enumValues);

  let sortColumn: (typeof SORTABLE_COLUMNS)[keyof typeof SORTABLE_COLUMNS] = tasks.dueDate;
  let sortDesc = false;
  const sortParam = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  if (sortParam) {
    try {
      const parsed = JSON.parse(sortParam) as { id: string; desc: boolean }[];
      const first = parsed[0];
      if (first && first.id in SORTABLE_COLUMNS) {
        sortColumn = SORTABLE_COLUMNS[first.id as keyof typeof SORTABLE_COLUMNS];
        sortDesc = first.desc;
      }
    } catch {
      // malformed sort param — fall back to the default
    }
  }

  const conditions: (SQL | undefined)[] = [
    taskScopeCondition(employee),
    isNull(tasks.archivedAt)
  ];
  if (statusFilter) conditions.push(inArray(tasks.status, statusFilter));
  if (priorityFilter) conditions.push(inArray(tasks.priority, priorityFilter));
  const whereCondition = and(...conditions);

  // Board/Calendar/Timeline/My Day each group or filter every visible task client-side rather
  // than paginating — capped at a sane ceiling so one team's view can't pull the whole table
  // into a single request.
  const UNPAGINATED_CAP = 300;
  const isPaginatedView = view === 'list';

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        assigneeId: tasks.assigneeId,
        assigneeName: employeeDisplayName,
        clientName: clients.name,
        projectName: projects.name
      })
      .from(tasks)
      .leftJoin(employees, eq(tasks.assigneeId, employees.id))
      .leftJoin(clients, eq(tasks.clientId, clients.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(whereCondition)
      .orderBy(sortDesc ? desc(sortColumn) : asc(sortColumn))
      .limit(isPaginatedView ? perPage : UNPAGINATED_CAP)
      .offset(isPaginatedView ? (page - 1) * perPage : 0),
    isPaginatedView ? db.select({ total: count() }).from(tasks).where(whereCondition) : Promise.resolve([{ total: 0 }])
  ]);
  const total = totalResult[0].total;

  const pageCount = Math.max(1, Math.ceil(total / perPage));

  // Options for the "New Task" dialog and inline assignee picker, scoped the same way the
  // permission layer scopes Task visibility (own/team/all) — an EMPLOYEE can only assign to
  // themselves, a TEAM_LEAD within their own team, MANAGER/ADMIN to anyone active.
  const assigneeCondition =
    scope === 'all' || scope === 'cross-team'
      ? eq(employees.status, 'active')
      : scope === 'team' && employee.team
        ? and(eq(employees.status, 'active'), eq(employees.team, employee.team))
        : and(eq(employees.status, 'active'), eq(employees.id, employee.id));

  const [assignableEmployees, clientOptions, projectOptions] = await Promise.all([
    db.select({ id: employees.id, name: employeeDisplayName }).from(employees).where(assigneeCondition),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.status, 'active')),
    db.select({ id: projects.id, name: projects.name }).from(projects)
  ]);

  return (
    <PageContainer
      pageTitle='My Work'
      infoContent={MY_WORK_GUIDE}
      pageDescription='Create, assign, and track tasks.'
      pageHeaderAction={
        // `min-w-0` on the toggle lets it become narrower than its five segments so its own
        // sideways scroll engages; without it the track keeps its full width and pushes the
        // New Task button off a phone screen.
        <div className='flex items-center gap-2'>
          <div className='min-w-0 flex-1'>
            <TaskViewToggle view={view} />
          </div>
          <CreateTaskDialog
            assignableEmployees={assignableEmployees}
            clients={clientOptions}
            projects={projectOptions}
          />
        </div>
      }
    >
      {view === 'board' && <TaskBoard data={rows} />}
      {view === 'calendar' && <TaskCalendar tasks={rows} month={month} />}
      {view === 'timeline' && <TaskTimeline tasks={rows} />}
      {view === 'day' && <MyDayView tasks={rows} currentEmployeeId={employee.id} />}
      {view === 'list' && (
        <TasksTable data={rows} pageCount={pageCount} assignableEmployees={assignableEmployees} />
      )}
    </PageContainer>
  );
}
