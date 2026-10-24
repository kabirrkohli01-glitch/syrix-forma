import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { format } from 'date-fns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChecklistCard } from '@/features/tasks/components/checklist-card';
import { CommentsCard } from '@/features/tasks/components/comments-card';
import { DependenciesCard } from '@/features/tasks/components/dependencies-card';
import { RecurrenceEditor } from '@/features/tasks/components/recurrence-editor';
import { SubtasksCard } from '@/features/tasks/components/subtasks-card';
import { WatchersCard } from '@/features/tasks/components/watchers-card';
import { DocumentLinksCard } from '@/features/document-links/components/document-links-card';
import { taskScopeCondition } from '@/features/tasks/utils/scope';
import { TASK_PRIORITY_VARIANT, TASK_STATUS_LABEL } from '@/features/tasks/utils/labels';
import type { RecurrenceRule } from '@/features/tasks/utils/schemas';
import { db } from '@/lib/db/client';
import {
  auditLog,
  checklistItems,
  documentLinks,
  employees,
  taskComments,
  taskDependencies,
  taskWatchers,
  tasks
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canEditTask, canViewTask } from '@/lib/permissions/task-access';

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [task] = await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, id)).limit(1);
  return { title: task?.title ?? 'Task' };
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await requireActiveEmployeeForPage();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) notFound();

  const target = { id: task.id, assigneeId: task.assigneeId, team: task.team };
  if (!canViewTask(employee, target)) notFound();
  const canManage = canEditTask(employee, target);

  const dependsOnTasks = alias(tasks, 'depends_on_tasks');

  const [
    assignee,
    parent,
    subtaskRows,
    checklist,
    commentRows,
    watcherRows,
    dependencyRows,
    candidateTaskRows,
    linkedDocuments,
    activity
  ] = await Promise.all([
    task.assigneeId
      ? db.select({ name: employeeDisplayName }).from(employees).where(eq(employees.id, task.assigneeId)).limit(1)
      : Promise.resolve([]),
    task.parentTaskId
      ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, task.parentTaskId)).limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        team: tasks.team,
        assigneeName: employeeDisplayName
      })
      .from(tasks)
      .leftJoin(employees, eq(tasks.assigneeId, employees.id))
      .where(and(eq(tasks.parentTaskId, id), isNull(tasks.archivedAt))),
    db.select().from(checklistItems).where(eq(checklistItems.taskId, id)).orderBy(asc(checklistItems.position)),
    db
      .select({
        id: taskComments.id,
        body: taskComments.body,
        authorEmployeeId: taskComments.authorEmployeeId,
        authorName: employeeDisplayName,
        createdAt: taskComments.createdAt
      })
      .from(taskComments)
      .leftJoin(employees, eq(taskComments.authorEmployeeId, employees.id))
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt)),
    db
      .select({ id: taskWatchers.id, employeeId: taskWatchers.employeeId, employeeName: employeeDisplayName })
      .from(taskWatchers)
      .innerJoin(employees, eq(taskWatchers.employeeId, employees.id))
      .where(eq(taskWatchers.taskId, id)),
    db
      .select({
        id: taskDependencies.id,
        dependsOnTaskId: taskDependencies.dependsOnTaskId,
        dependsOnTitle: dependsOnTasks.title,
        dependsOnStatus: dependsOnTasks.status
      })
      .from(taskDependencies)
      .innerJoin(dependsOnTasks, eq(taskDependencies.dependsOnTaskId, dependsOnTasks.id))
      .where(eq(taskDependencies.taskId, id)),
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(taskScopeCondition(employee), isNull(tasks.archivedAt), ne(tasks.id, id)))
      .limit(200),
    db.select().from(documentLinks).where(eq(documentLinks.taskId, id)),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.resourceType, 'task'), eq(auditLog.resourceId, id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(20)
  ]);

  const visibleSubtasks = subtaskRows.filter((s) => canViewTask(employee, s));

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:px-6'>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center gap-2'>
            {parent[0] && (
              <Link href={`/dashboard/my-work/${parent[0].id}`} className='text-muted-foreground text-xs hover:underline'>
                {parent[0].title} /
              </Link>
            )}
          </div>
          <CardTitle>{task.title}</CardTitle>
          {task.description && <CardDescription className='whitespace-pre-wrap'>{task.description}</CardDescription>}
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline'>{TASK_STATUS_LABEL[task.status]}</Badge>
          <Badge variant={TASK_PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
          <Badge variant='outline'>{task.team}</Badge>
          {task.dueDate && (
            <span className='text-muted-foreground text-sm'>Due {format(task.dueDate, 'MMM d, yyyy')}</span>
          )}
          {assignee[0] && <span className='text-muted-foreground text-sm'>Assigned to {assignee[0].name}</span>}
        </CardContent>
      </Card>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.checks className='size-4' />
              Subtasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SubtasksCard parentTaskId={task.id} subtasks={visibleSubtasks} canManage={canManage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.listChecks className='size-4' />
              Checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChecklistCard taskId={task.id} items={checklist} canManage={canManage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.link className='size-4' />
              Dependencies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DependenciesCard
              taskId={task.id}
              dependencies={dependencyRows}
              candidateTasks={candidateTaskRows}
              canManage={canManage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.eye className='size-4' />
              Watchers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <WatchersCard
              taskId={task.id}
              watchers={watcherRows}
              currentEmployeeId={employee.id}
              canView={canViewTask(employee, target)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.clock className='size-4' />
              Recurrence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RecurrenceEditor
              taskId={task.id}
              rule={task.recurrenceRule as RecurrenceRule | null}
              canManage={canManage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.paperclip className='size-4' />
              Attachments
            </CardTitle>
            <CardDescription>Reference-only links — SYRIX Forma never stores the file itself.</CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentLinksCard
              taskId={task.id}
              canManage={canManage}
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Icons.chat className='size-4' />
            Comments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CommentsCard
            taskId={task.id}
            comments={commentRows.map((c) => ({ ...c, authorName: c.authorName ?? 'Former employee' }))}
            currentEmployeeId={employee.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Recent actions recorded against this task.</CardDescription>
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
