import { and, count, eq, isNull, ne } from 'drizzle-orm';
import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { TEAMS_GUIDE } from '@/config/page-guides';
import { StaggerItem, StaggerList } from '@/components/motion/stagger-list';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBoard } from '@/features/teams/components/status-board';
import { WorkStatusButtons } from '@/features/teams/components/work-status-buttons';
import { db } from '@/lib/db/client';
import { clients, employees, projectStaff, projects, tasks } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Teams' };

// Deliberately not a new Team entity — `team` stays the free-text column every other resource
// already uses (Client/Project/Task/Enquiry/CalendarEvent), set at creation and ADMIN-reassignable
// (see schema.ts's comment on tasks.team for why). A dashboard computed over that existing column
// delivers the build plan's "departments, managers, shared work, team dashboards" without a schema
// migration touching six tables.
export default async function TeamsPage() {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Teams' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [employeeRows, openTaskCountRows, currentWorkRows] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employeeDisplayName,
        role: employees.role,
        team: employees.team,
        status: employees.status,
        workStatus: employees.workStatus,
        workStatusChangedAt: employees.workStatusChangedAt
      })
      .from(employees)
      .where(eq(employees.status, 'active')),
    // Real proxy for "workload" — an honest open-task count, never a fabricated percentage.
    db
      .select({ employeeId: tasks.assigneeId, total: count() })
      .from(tasks)
      .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done')))
      .groupBy(tasks.assigneeId),
    // "Current work": each employee's first active project via project_staff, if any.
    db
      .select({ employeeId: projectStaff.employeeId, projectName: projects.name })
      .from(projectStaff)
      .innerJoin(projects, and(eq(projects.id, projectStaff.projectId), eq(projects.status, 'active')))
  ]);

  const openTaskCountByEmployee = new Map(
    openTaskCountRows.filter((r) => r.employeeId).map((r) => [r.employeeId as string, r.total])
  );
  const currentWorkByEmployee = new Map<string, string>();
  for (const row of currentWorkRows) {
    if (!currentWorkByEmployee.has(row.employeeId)) currentWorkByEmployee.set(row.employeeId, row.projectName);
  }

  const allEmployees = employeeRows.map((e) => ({
    ...e,
    openTaskCount: openTaskCountByEmployee.get(e.id) ?? 0,
    currentWork: currentWorkByEmployee.get(e.id) ?? null
  }));

  const callerRow = allEmployees.find((e) => e.id === employee.id);

  const visibleTeamNames =
    scope === 'all' || scope === 'cross-team'
      ? [...new Set(allEmployees.map((e) => e.team).filter((t): t is string => !!t))].toSorted()
      : employee.team
        ? [employee.team]
        : [];

  const teamStats = await Promise.all(
    visibleTeamNames.map(async (teamName) => {
      const members = allEmployees.filter((e) => e.team === teamName);
      const managers = members.filter((m) => m.role === 'TEAM_LEAD' || m.role === 'MANAGER');

      const [[openTasks], [activeProjects], [activeClients]] = await Promise.all([
        db
          .select({ total: count() })
          .from(tasks)
          .where(and(eq(tasks.team, teamName), isNull(tasks.archivedAt), ne(tasks.status, 'done'))),
        db.select({ total: count() }).from(projects).where(and(eq(projects.team, teamName), eq(projects.status, 'active'))),
        db.select({ total: count() }).from(clients).where(and(eq(clients.team, teamName), eq(clients.status, 'active')))
      ]);

      return {
        teamName,
        members,
        managers,
        openTasks: openTasks.total,
        activeProjects: activeProjects.total,
        activeClients: activeClients.total
      };
    })
  );

  return (
    <PageContainer
      pageTitle='Teams'
      pageDescription='Who is working right now, and what each team is carrying.'
      infoContent={TEAMS_GUIDE}
    >
      <div className='flex flex-col gap-4'>
        <Card>
          <CardHeader>
            <CardTitle className='text-xs font-medium tracking-wider uppercase'>Your status</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <div className='flex flex-wrap items-center gap-3'>
              {callerRow && <WorkStatusButtons currentStatus={callerRow.workStatus} />}
              <span className='text-muted-foreground text-xs'>
                Live status only — not logged as a timesheet.
              </span>
            </div>
            <StatusBoard members={allEmployees} />
          </CardContent>
        </Card>
        {teamStats.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No team assigned yet.</p>
        ) : (
          <StaggerList className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
            {teamStats.map((team) => (
              <StaggerItem key={team.teamName}>
              <Card>
                <CardHeader>
                  <CardTitle className='capitalize'>{team.teamName}</CardTitle>
                  <div className='flex flex-wrap gap-1.5 pt-1'>
                    {team.managers.length === 0 ? (
                      <span className='text-muted-foreground text-xs'>No manager assigned</span>
                    ) : (
                      team.managers.map((m) => (
                        <Badge key={m.id} variant='outline'>
                          {m.name}
                        </Badge>
                      ))
                    )}
                  </div>
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  <div className='grid grid-cols-3 gap-2 text-center'>
                    <div>
                      <p className='text-2xl font-semibold'>{team.openTasks}</p>
                      <p className='text-muted-foreground text-xs'>Open tasks</p>
                    </div>
                    <div>
                      <p className='text-2xl font-semibold'>{team.activeProjects}</p>
                      <p className='text-muted-foreground text-xs'>Active projects</p>
                    </div>
                    <div>
                      <p className='text-2xl font-semibold'>{team.activeClients}</p>
                      <p className='text-muted-foreground text-xs'>Active clients</p>
                    </div>
                  </div>
                  <div>
                    <p className='text-muted-foreground mb-1.5 text-xs font-medium'>
                      {team.members.length} member{team.members.length === 1 ? '' : 's'}
                    </p>
                    <ul className='flex flex-col gap-1'>
                      {team.members.map((member) => (
                        <li
                          key={member.id}
                          className='hover:bg-muted/50 -mx-1 flex items-center justify-between rounded-md px-1 py-0.5 text-sm transition-colors duration-150'
                        >
                          <span>{member.name}</span>
                          <Badge variant='secondary' className='text-xs'>
                            {member.role}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </div>
    </PageContainer>
  );
}
