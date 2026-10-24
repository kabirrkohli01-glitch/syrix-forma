import type { Metadata } from 'next';
import { REPORTS_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { StaggerItem, StaggerList } from '@/components/motion/stagger-list';
import { StatCard } from '@/components/stat-card';
import { AutomationPerformanceTable } from '@/features/reports/components/automation-performance-report';
import { ClientActivityView, ResponseTimeView } from '@/features/reports/components/client-report';
import {
  ActiveProjectsSummaryView,
  OverdueWorkView,
  ProjectHealthTable
} from '@/features/reports/components/delivery-report';
import {
  ClientHealthOverview,
  OpenTasksByEmployeeChart,
  TasksPerWeekChart
} from '@/features/reports/components/overview-charts';
import { ReportSection } from '@/features/reports/components/stat-card';
import { TrendsTable } from '@/features/reports/components/trends-report';
import {
  WorkloadByEmployeeTable,
  WorkloadByTeamTable
} from '@/features/reports/components/workload-report';
import {
  getActiveProjectsSummary,
  getAutomationPerformance,
  getClientActivity,
  getOperationalTrends,
  getOverdueWork,
  getProjectHealth,
  getResponseTimeStats,
  getWorkloadByEmployee,
  getWorkloadByTeam
} from '@/features/reports/utils/queries';
import { canViewAutomations } from '@/lib/permissions/automation-access';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canViewBasicReports } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Reports' };

// the build plan Phase 6 — permission-scoped exactly like every other view, but "scoped" here
// means the page-level gate, not row-level filtering: canViewBasicReports is MANAGER/ADMIN only,
// and scopeForBusinessData already makes both of those roles see cross-team/all business data
// everywhere else in the app, so every query below runs unfiltered rather than repeating a scope
// condition that would always resolve to "no filter" for the only two roles that can reach this
// page. Automation performance is gated a level stricter (ADMIN-only, canViewAutomations) inside
// the page, same tier as the Automations page itself and the Action Centre's admin-only sections.
export default async function ReportsPage() {
  const employee = await requireActiveEmployeeForPage();

  if (!canViewBasicReports(employee.role)) {
    return (
      <PageContainer pageTitle='Reports' access={false}>
        {null}
      </PageContainer>
    );
  }

  const now = new Date();
  const canSeeAutomationPerformance = canViewAutomations(employee);

  const [
    employeeWorkload,
    teamWorkload,
    activeProjects,
    clientActivity,
    overdueWork,
    responseTimes,
    projectHealth,
    trends,
    automationPerformance
  ] = await Promise.all([
    getWorkloadByEmployee(now),
    getWorkloadByTeam(now),
    getActiveProjectsSummary(),
    getClientActivity(now),
    getOverdueWork(now),
    getResponseTimeStats(),
    getProjectHealth(now),
    getOperationalTrends(now),
    canSeeAutomationPerformance ? getAutomationPerformance() : Promise.resolve([])
  ]);

  const redProjects = projectHealth.filter((p) => p.health === 'red').length;
  const amberProjects = projectHealth.filter((p) => p.health === 'amber').length;

  return (
    <PageContainer
      pageTitle='Reports'
      infoContent={REPORTS_GUIDE}
      pageDescription='Workload, delivery, client and automation metrics across the whole company.'
    >
      <div className='flex flex-col gap-4'>
        <StaggerList className='grid grid-cols-2 gap-4 md:grid-cols-4'>
          <StaggerItem>
            <StatCard
              label='Open tasks'
              value={employeeWorkload.reduce((sum, e) => sum + e.openCount, 0)}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard label='Overdue tasks' value={overdueWork.overdueTaskCount} />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label='Active projects'
              value={activeProjects.byStatus.find((s) => s.status === 'active')?.count ?? 0}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label='Project health'
              value={`${redProjects} red / ${amberProjects} amber`}
              sublabel={`of ${projectHealth.length} active projects`}
            />
          </StaggerItem>
        </StaggerList>

        <StaggerList className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <StaggerItem>
            <OpenTasksByEmployeeChart rows={employeeWorkload} />
          </StaggerItem>
          <StaggerItem>
            <TasksPerWeekChart rows={trends} />
          </StaggerItem>
        </StaggerList>

        <ClientHealthOverview rows={projectHealth} />

        <ReportSection title='Workload' description='Open work per employee, right now.'>
          <WorkloadByEmployeeTable rows={employeeWorkload} />
        </ReportSection>

        <ReportSection title='Team workload' description='The same open work, rolled up by team.'>
          <WorkloadByTeamTable rows={teamWorkload} />
        </ReportSection>

        <ReportSection title='Active projects' description='Project counts by status and by team.'>
          <ActiveProjectsSummaryView summary={activeProjects} />
        </ReportSection>

        <ReportSection
          title='Project health'
          description='Overdue tasks/milestones per active project — see below for the rule.'
        >
          <ProjectHealthTable rows={projectHealth} />
          <p className='text-muted-foreground text-xs'>
            Red: any overdue milestone, or 3+ overdue tasks. Amber: 1–2 overdue tasks with no
            overdue milestones. Green: neither.
          </p>
        </ReportSection>

        <ReportSection
          title='Overdue work'
          description='Everything past its due date and not yet done.'
        >
          <OverdueWorkView report={overdueWork} />
        </ReportSection>

        <ReportSection
          title='Client activity'
          description='Most recently active clients, and which active clients have gone quiet.'
        >
          <ClientActivityView report={clientActivity} />
        </ReportSection>

        <ReportSection
          title='Response times & SLA'
          description='How quickly enquiries get a first reply by email.'
        >
          <ResponseTimeView stats={responseTimes} />
        </ReportSection>

        {canSeeAutomationPerformance && (
          <ReportSection
            title='Automation performance'
            description='Run outcomes and timing per automation.'
          >
            <AutomationPerformanceTable rows={automationPerformance} />
          </ReportSection>
        )}

        <ReportSection
          title='Operational trends'
          description='Tasks and enquiries created per week, last 8 weeks.'
        >
          <TrendsTable rows={trends} />
        </ReportSection>
      </div>
    </PageContainer>
  );
}
