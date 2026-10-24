import { and, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/ui/status-badge';
import { DocumentLinksCard } from '@/features/document-links/components/document-links-card';
import { EditProjectDialog } from '@/features/projects/components/edit-project-dialog';
import { ProjectMilestones } from '@/features/projects/components/project-milestones';
import { ProjectStaffManager } from '@/features/projects/components/project-staff-manager';
import { db } from '@/lib/db/client';
import {
  clients,
  documentLinks,
  employees,
  projectMilestones,
  projectStaff,
  projects,
  tasks
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '@/lib/status-colors';
import {
  canEditProject,
  canManageProjectStaff,
  canViewProject
} from '@/lib/permissions/project-access';
import { canViewTask } from '@/lib/permissions/task-access';

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return { title: project?.name ?? 'Project' };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await requireActiveEmployeeForPage();

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      team: projects.team,
      status: projects.status,
      clientId: projects.clientId,
      clientName: clients.name
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) notFound();

  const [staffRow] = await db
    .select({ id: projectStaff.id })
    .from(projectStaff)
    .where(and(eq(projectStaff.projectId, id), eq(projectStaff.employeeId, employee.id)))
    .limit(1);
  const isStaffed = !!staffRow;

  if (!canViewProject(employee, { id: project.id, team: project.team }, isStaffed)) notFound();

  const canManageStaff = canManageProjectStaff(employee, { id: project.id, team: project.team });
  // addMilestone/completeMilestone are gated by canEditProject server-side, a broader check
  // than canManageProjectStaff (an EMPLOYEE staffed on the project can edit milestones but
  // not manage who else is staffed) — the milestone UI must follow that same, wider gate.
  const canEditThisProject = canEditProject(
    employee,
    { id: project.id, team: project.team },
    isStaffed
  );

  const [staffedEmployees, allActiveEmployees, linkedTasks, milestones, linkedDocuments] =
    await Promise.all([
      db
        .select({ id: employees.id, name: employeeDisplayName })
        .from(projectStaff)
        .innerJoin(employees, eq(projectStaff.employeeId, employees.id))
        .where(eq(projectStaff.projectId, id)),
      db
        .select({ id: employees.id, name: employeeDisplayName })
        .from(employees)
        .where(eq(employees.status, 'active')),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          assigneeId: tasks.assigneeId,
          team: tasks.team
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, id), isNull(tasks.archivedAt))),
      db
        .select()
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, id))
        .orderBy(projectMilestones.dueDate),
      db.select().from(documentLinks).where(eq(documentLinks.projectId, id))
    ]);

  // Same reasoning as the Client detail page: Task's own/team scoping can be stricter than
  // Project's, so filter linked tasks per row rather than trust the project-level gate above.
  const visibleTasks = linkedTasks.filter((task) => canViewTask(employee, task));

  const addableEmployees = allActiveEmployees.filter(
    (candidate) => !staffedEmployees.some((s) => s.id === candidate.id)
  );

  const completedMilestoneCount = milestones.filter((m) => m.completedAt).length;
  const percentComplete =
    milestones.length === 0
      ? 0
      : Math.round((completedMilestoneCount / milestones.length) * 100);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:px-6'>
      <Card>
        <CardHeader>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <CardTitle>{project.name}</CardTitle>
              <CardDescription>
                <Link href={`/dashboard/clients/${project.clientId}`} className='hover:underline'>
                  {project.clientName}
                </Link>
              </CardDescription>
            </div>
            {canEditThisProject && (
              <EditProjectDialog
                projectId={project.id}
                currentName={project.name}
                currentStatus={project.status}
                currentTeam={project.team}
                canChangeTeam={employee.role === 'ADMIN'}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>{project.team}</Badge>
            <StatusBadge tone={PROJECT_STATUS_TONE[project.status]}>
              {PROJECT_STATUS_LABEL[project.status]}
            </StatusBadge>
          </div>
          {milestones.length > 0 && (
            <div className='flex items-center gap-3'>
              <Progress value={percentComplete} className='max-w-md flex-1' />
              <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                {percentComplete}% complete
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Staff</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectStaffManager
              projectId={project.id}
              staffed={staffedEmployees}
              addableEmployees={addableEmployees}
              canManage={canManageStaff}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectMilestones
              projectId={project.id}
              milestones={milestones}
              canManage={canEditThisProject}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
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
                  <Badge variant='outline'>{task.status}</Badge>
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
            projectId={project.id}
            canManage={canEditThisProject}
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
  );
}
