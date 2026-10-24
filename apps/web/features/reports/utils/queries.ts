import { addWeeks, startOfWeek, subWeeks } from 'date-fns';
import { and, eq, gte, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  automationRuns,
  automations,
  clientNotes,
  clients,
  emailActivity,
  employees,
  enquiries,
  projectMilestones,
  projects,
  tasks
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { computeProjectHealth, type ProjectHealth } from './health';

// Every function here is read-only and runs unfiltered by team — Reports is gated at the page
// level to MANAGER/ADMIN only (lib/permissions/roles.ts's canViewBasicReports), and both of
// those roles already see cross-team/all business data (scopeForBusinessData), so there is no
// per-row scope condition to apply on top, unlike every other list/dashboard query in this app.

// How long a client should wait for a first reply after an enquiry comes in. Fixed here rather
// than a configurable column — Reports is a read-only view; a configurable SLA target is a real
// feature (a settings row + admin UI) nobody has asked for yet.
export const RESPONSE_SLA_HOURS = 48;

// Active clients with no activity at all, or none inside this window, are called out as "stale"
// on the Client Activity report.
const STALE_THRESHOLD_DAYS = 30;

const TREND_WEEKS = 8;

export type EmployeeWorkload = {
  id: string;
  name: string;
  team: string | null;
  role: string | null;
  openCount: number;
  inProgressCount: number;
  overdueCount: number;
};

export async function getWorkloadByEmployee(now: Date): Promise<EmployeeWorkload[]> {
  const activeEmployees = await db
    .select({ id: employees.id, name: employeeDisplayName, team: employees.team, role: employees.role })
    .from(employees)
    .where(eq(employees.status, 'active'));

  const openTasks = await db
    .select({ assigneeId: tasks.assigneeId, status: tasks.status, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done')));

  return activeEmployees
    .map((emp) => {
      const own = openTasks.filter((t) => t.assigneeId === emp.id);
      return {
        ...emp,
        openCount: own.length,
        inProgressCount: own.filter((t) => t.status === 'in_progress').length,
        overdueCount: own.filter((t) => t.dueDate && t.dueDate < now).length
      };
    })
    .toSorted((a, b) => b.openCount - a.openCount);
}

export type TeamWorkload = {
  team: string;
  memberCount: number;
  openCount: number;
  overdueCount: number;
  unassignedOpenCount: number;
};

export async function getWorkloadByTeam(now: Date): Promise<TeamWorkload[]> {
  const activeEmployees = await db
    .select({ id: employees.id, team: employees.team })
    .from(employees)
    .where(eq(employees.status, 'active'));

  // A task's own team (tasks.team) decides which team's workload it counts toward — not the
  // assignee's team — same distinction schema.ts documents for that column generally.
  const openTasks = await db
    .select({ assigneeId: tasks.assigneeId, team: tasks.team, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done')));

  const teamNames = [
    ...new Set(activeEmployees.map((e) => e.team).filter((t): t is string => !!t))
  ].toSorted();

  return teamNames.map((team) => {
    const memberCount = activeEmployees.filter((e) => e.team === team).length;
    const teamTasks = openTasks.filter((t) => t.team === team);
    return {
      team,
      memberCount,
      openCount: teamTasks.length,
      overdueCount: teamTasks.filter((t) => t.dueDate && t.dueDate < now).length,
      unassignedOpenCount: teamTasks.filter((t) => !t.assigneeId).length
    };
  });
}

export type ActiveProjectsSummary = {
  total: number;
  byStatus: { status: string; count: number }[];
  byTeam: { team: string; activeCount: number }[];
};

export async function getActiveProjectsSummary(): Promise<ActiveProjectsSummary> {
  const allProjects = await db
    .select({ team: projects.team, status: projects.status })
    .from(projects);

  const statusCounts = new Map<string, number>();
  const activeByTeam = new Map<string, number>();
  for (const p of allProjects) {
    statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
    if (p.status === 'active') activeByTeam.set(p.team, (activeByTeam.get(p.team) ?? 0) + 1);
  }

  return {
    total: allProjects.length,
    byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    byTeam: [...activeByTeam.entries()]
      .map(([team, activeCount]) => ({ team, activeCount }))
      .toSorted((a, b) => b.activeCount - a.activeCount)
  };
}

export type ClientActivityRow = {
  id: string;
  name: string;
  team: string;
  lastActivityAt: Date | null;
};
export type ActiveClientActivityRow = ClientActivityRow & { lastActivityAt: Date };
export type ClientActivityReport = {
  totalActive: number;
  staleCount: number;
  staleThresholdDays: number;
  mostActive: ActiveClientActivityRow[];
};

// "Activity" is the most recent of: a task update, an email (inbound or outbound), or a note —
// on that client. All three already exist on Client Centre (Phase 5); this just takes the max
// across them instead of surfacing them as three separate lists.
export async function getClientActivity(now: Date): Promise<ClientActivityReport> {
  const activeClients = await db
    .select({ id: clients.id, name: clients.name, team: clients.team })
    .from(clients)
    .where(eq(clients.status, 'active'));

  const [taskRows, emailRows, noteRows] = await Promise.all([
    db
      .select({ clientId: tasks.clientId, updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(isNotNull(tasks.clientId)),
    db
      .select({ clientId: emailActivity.clientId, occurredAt: emailActivity.occurredAt })
      .from(emailActivity)
      .where(isNotNull(emailActivity.clientId)),
    db
      .select({ clientId: clientNotes.clientId, createdAt: clientNotes.createdAt })
      .from(clientNotes)
  ]);

  const lastActivity = new Map<string, Date>();
  const bump = (clientId: string | null, at: Date) => {
    if (!clientId) return;
    const existing = lastActivity.get(clientId);
    if (!existing || at > existing) lastActivity.set(clientId, at);
  };
  taskRows.forEach((t) => bump(t.clientId, t.updatedAt));
  emailRows.forEach((e) => bump(e.clientId, e.occurredAt));
  noteRows.forEach((n) => bump(n.clientId, n.createdAt));

  const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const rows: ClientActivityRow[] = activeClients.map((c) => ({
    ...c,
    lastActivityAt: lastActivity.get(c.id) ?? null
  }));

  return {
    totalActive: rows.length,
    staleCount: rows.filter((r) => !r.lastActivityAt || r.lastActivityAt < staleThreshold).length,
    staleThresholdDays: STALE_THRESHOLD_DAYS,
    mostActive: rows
      .filter((r): r is ActiveClientActivityRow => r.lastActivityAt !== null)
      .toSorted((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
      .slice(0, 15)
  };
}

export type OverdueWorkReport = {
  overdueTaskCount: number;
  overdueTasksByTeam: { team: string; count: number }[];
  overdueMilestoneCount: number;
  overdueMilestonesByTeam: { team: string; count: number }[];
};

function countByTeam(rows: { team: string }[]) {
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.team, (counts.get(r.team) ?? 0) + 1));
  return [...counts.entries()]
    .map(([team, count]) => ({ team, count }))
    .toSorted((a, b) => b.count - a.count);
}

export async function getOverdueWork(now: Date): Promise<OverdueWorkReport> {
  const overdueTasks = await db
    .select({ team: tasks.team })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), ne(tasks.status, 'done'), lt(tasks.dueDate, now)));

  const overdueMilestoneRows = await db
    .select({ team: projects.team })
    .from(projectMilestones)
    .innerJoin(projects, eq(projectMilestones.projectId, projects.id))
    .where(and(isNull(projectMilestones.completedAt), lt(projectMilestones.dueDate, now)));

  return {
    overdueTaskCount: overdueTasks.length,
    overdueTasksByTeam: countByTeam(overdueTasks),
    overdueMilestoneCount: overdueMilestoneRows.length,
    overdueMilestonesByTeam: countByTeam(overdueMilestoneRows)
  };
}

export type ResponseTimeStats = {
  respondedCount: number;
  pendingCount: number;
  avgResponseHours: number | null;
  medianResponseHours: number | null;
  slaHours: number;
  withinSlaCount: number;
  withinSlaPct: number | null;
};

// "Response" here means the first outbound email linked to an enquiry — the only response
// channel this app has an accurate timestamp for. A reply given by phone or in person isn't
// tracked and is deliberately not guessed at; such an enquiry just shows as pending here even if
// it was actually handled, and that gap is real, not a bug.
export async function getResponseTimeStats(): Promise<ResponseTimeStats> {
  const enquiryRows = await db
    .select({ id: enquiries.id, createdAt: enquiries.createdAt })
    .from(enquiries);

  const firstReplyRows = await db
    .select({ enquiryId: emailActivity.enquiryId, occurredAt: emailActivity.occurredAt })
    .from(emailActivity)
    .where(and(eq(emailActivity.direction, 'outbound'), isNotNull(emailActivity.enquiryId)));

  const firstReplyByEnquiry = new Map<string, Date>();
  for (const row of firstReplyRows) {
    if (!row.enquiryId) continue;
    const existing = firstReplyByEnquiry.get(row.enquiryId);
    if (!existing || row.occurredAt < existing)
      firstReplyByEnquiry.set(row.enquiryId, row.occurredAt);
  }

  const responseHours: number[] = [];
  for (const enquiry of enquiryRows) {
    const firstReply = firstReplyByEnquiry.get(enquiry.id);
    if (firstReply)
      responseHours.push((firstReply.getTime() - enquiry.createdAt.getTime()) / (1000 * 60 * 60));
  }

  const sorted = [...responseHours].toSorted((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const withinSlaCount = responseHours.filter((h) => h <= RESPONSE_SLA_HOURS).length;

  return {
    respondedCount: responseHours.length,
    pendingCount: enquiryRows.length - responseHours.length,
    avgResponseHours: responseHours.length
      ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length
      : null,
    medianResponseHours: median,
    slaHours: RESPONSE_SLA_HOURS,
    withinSlaCount,
    withinSlaPct: responseHours.length
      ? Math.round((withinSlaCount / responseHours.length) * 100)
      : null
  };
}

export type AutomationPerformance = {
  key: string;
  name: string;
  totalRuns: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  inFlightCount: number;
  successRatePct: number | null;
  avgDurationSeconds: number | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
};

// ADMIN-only, gated separately from the rest of the Reports page (canViewAutomations) — same
// tier as Automations' own definitions/run-history view (docs/permissions-matrix.md).
export async function getAutomationPerformance(): Promise<AutomationPerformance[]> {
  const defs = await db
    .select({ id: automations.id, key: automations.key, name: automations.name })
    .from(automations);
  const runs = await db
    .select({
      automationId: automationRuns.automationId,
      status: automationRuns.status,
      startedAt: automationRuns.startedAt,
      finishedAt: automationRuns.finishedAt,
      createdAt: automationRuns.createdAt
    })
    .from(automationRuns);

  return defs
    .map((def) => {
      const own = runs.filter((r) => r.automationId === def.id);
      const successCount = own.filter((r) => r.status === 'success').length;
      const failedCount = own.filter((r) => r.status === 'failed').length;
      const skippedCount = own.filter((r) => r.status === 'skipped').length;
      const inFlightCount = own.filter(
        (r) => r.status === 'queued' || r.status === 'running'
      ).length;
      const durations = own
        .filter(
          (r): r is typeof r & { startedAt: Date; finishedAt: Date } =>
            !!r.startedAt && !!r.finishedAt
        )
        .map((r) => (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000);
      const lastRun = own.length
        ? own.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest))
        : null;
      const finishedCount = successCount + failedCount;

      return {
        key: def.key,
        name: def.name,
        totalRuns: own.length,
        successCount,
        failedCount,
        skippedCount,
        inFlightCount,
        successRatePct: finishedCount ? Math.round((successCount / finishedCount) * 100) : null,
        avgDurationSeconds: durations.length
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : null,
        lastRunAt: lastRun?.createdAt ?? null,
        lastRunStatus: lastRun?.status ?? null
      };
    })
    .toSorted((a, b) => b.totalRuns - a.totalRuns);
}

export type ProjectHealthRow = {
  id: string;
  name: string;
  team: string;
  clientName: string;
  openTaskCount: number;
  overdueTaskCount: number;
  overdueMilestoneCount: number;
  health: ProjectHealth;
};

export async function getProjectHealth(now: Date): Promise<ProjectHealthRow[]> {
  const activeProjects = await db
    .select({ id: projects.id, name: projects.name, team: projects.team, clientName: clients.name })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.status, 'active'));

  const projectTasks = await db
    .select({ projectId: tasks.projectId, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), isNotNull(tasks.projectId), ne(tasks.status, 'done')));

  const milestoneRows = await db
    .select({ projectId: projectMilestones.projectId, dueDate: projectMilestones.dueDate })
    .from(projectMilestones)
    .where(isNull(projectMilestones.completedAt));

  return activeProjects
    .map((project) => {
      const ownTasks = projectTasks.filter((t) => t.projectId === project.id);
      const overdueTaskCount = ownTasks.filter((t) => t.dueDate && t.dueDate < now).length;
      const overdueMilestoneCount = milestoneRows.filter(
        (m) => m.projectId === project.id && m.dueDate && m.dueDate < now
      ).length;

      return {
        ...project,
        openTaskCount: ownTasks.length,
        overdueTaskCount,
        overdueMilestoneCount,
        health: computeProjectHealth(overdueMilestoneCount, overdueTaskCount)
      };
    })
    .toSorted((a, b) => {
      const order: Record<ProjectHealth, number> = { red: 0, amber: 1, green: 2 };
      return order[a.health] - order[b.health];
    });
}

export type WeeklyTrendRow = { weekStart: Date; tasksCreated: number; enquiriesCreated: number };

// Bucketed by createdAt only — the one timestamp both Task and Enquiry record exactly and
// unconditionally. A "tasks completed" trend was deliberately left out: tasks has no
// completedAt column, and updatedAt changes on any edit, not just completion, so it can't
// answer "was this done in this window" without guessing.
export async function getOperationalTrends(now: Date): Promise<WeeklyTrendRow[]> {
  const windowStart = startOfWeek(subWeeks(now, TREND_WEEKS - 1), { weekStartsOn: 1 });

  const [taskRows, enquiryRows] = await Promise.all([
    db.select({ createdAt: tasks.createdAt }).from(tasks).where(gte(tasks.createdAt, windowStart)),
    db
      .select({ createdAt: enquiries.createdAt })
      .from(enquiries)
      .where(gte(enquiries.createdAt, windowStart))
  ]);

  const weeks: WeeklyTrendRow[] = [];
  for (let i = 0; i < TREND_WEEKS; i++) {
    const weekStart = startOfWeek(addWeeks(windowStart, i), { weekStartsOn: 1 });
    const weekEnd = addWeeks(weekStart, 1);
    weeks.push({
      weekStart,
      tasksCreated: taskRows.filter((t) => t.createdAt >= weekStart && t.createdAt < weekEnd)
        .length,
      enquiriesCreated: enquiryRows.filter((e) => e.createdAt >= weekStart && e.createdAt < weekEnd)
        .length
    });
  }
  return weeks;
}
