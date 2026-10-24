import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import {
  courseEnrolments,
  courses,
  employees,
  incidents,
  interviews,
  jobApplications,
  riskAssessments,
  safetyRoles,
  vacancies
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canViewApplications,
  canViewIncidentInjuryDetail,
  hrScopeFor,
  isHrAdmin,
  isLineManagerOf
} from '@/lib/permissions/hr-access';

function subjectVisibility(caller: ActiveEmployee, employeeIdColumn: AnyPgColumn) {
  if (hrScopeFor(caller) === 'all') return undefined;
  return or(eq(employeeIdColumn, caller.id), eq(employees.managerId, caller.id));
}

// --- Learning ---

export async function listCourses() {
  return db.select().from(courses).where(isNull(courses.archivedAt)).orderBy(courses.title);
}

export type EnrolmentRow = {
  id: string;
  courseId: string;
  courseTitle: string;
  externalUrl: string | null;
  estimatedMinutes: number | null;
  employeeId: string;
  employeeName: string;
  status: (typeof courseEnrolments.status.enumValues)[number];
  progressPercent: number;
  dueOn: string | null;
  completedOn: string | null;
  expiresOn: string | null;
};

export async function listEnrolments(caller: ActiveEmployee): Promise<EnrolmentRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select({
      id: courseEnrolments.id,
      courseId: courseEnrolments.courseId,
      courseTitle: courses.title,
      externalUrl: courses.externalUrl,
      estimatedMinutes: courses.estimatedMinutes,
      employeeId: courseEnrolments.employeeId,
      employeeName: employeeDisplayName,
      status: courseEnrolments.status,
      progressPercent: courseEnrolments.progressPercent,
      dueOn: courseEnrolments.dueOn,
      completedOn: courseEnrolments.completedOn,
      expiresOn: courseEnrolments.expiresOn
    })
    .from(courseEnrolments)
    .innerJoin(courses, eq(courses.id, courseEnrolments.courseId))
    .innerJoin(employees, eq(employees.id, courseEnrolments.employeeId))
    .where(subjectVisibility(caller, courseEnrolments.employeeId))
    .orderBy(courseEnrolments.dueOn);
}

// --- Health and safety ---

export async function listRiskAssessments() {
  return db.select().from(riskAssessments).orderBy(desc(riskAssessments.assessedOn));
}

export type IncidentRow = {
  id: string;
  kind: (typeof incidents.kind.enumValues)[number];
  occurredAt: Date;
  location: string | null;
  description: string;
  affectedEmployeeId: string | null;
  affectedEmployeeName: string | null;
  immediateAction: string | null;
  riddorReportable: boolean;
  closedAt: Date | null;
  /** Null when the caller is not entitled to the health detail. */
  medical: { injuryDetail: string | null; investigationNotes: string | null } | null;
};

/**
 * The incident log, with injury detail redacted per row.
 *
 * Everyone sees that an incident happened, where, and what was done — that is how a safety log
 * prevents the next one. Only the person involved and HR see the injury itself, which is
 * health data under the same rule as sickness. Redacted in the query, not the component.
 */
export async function listIncidents(caller: ActiveEmployee): Promise<IncidentRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const rows = await db
    .select({
      id: incidents.id,
      kind: incidents.kind,
      occurredAt: incidents.occurredAt,
      location: incidents.location,
      description: incidents.description,
      affectedEmployeeId: incidents.affectedEmployeeId,
      affectedEmployeeName: employeeDisplayName,
      injuryDetail: incidents.injuryDetail,
      investigationNotes: incidents.investigationNotes,
      immediateAction: incidents.immediateAction,
      riddorReportable: incidents.riddorReportable,
      closedAt: incidents.closedAt
    })
    .from(incidents)
    .leftJoin(employees, eq(employees.id, incidents.affectedEmployeeId))
    .orderBy(desc(incidents.occurredAt));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurredAt,
    location: row.location,
    description: row.description,
    affectedEmployeeId: row.affectedEmployeeId,
    affectedEmployeeName: row.affectedEmployeeName,
    immediateAction: row.immediateAction,
    riddorReportable: row.riddorReportable,
    closedAt: row.closedAt,
    medical: canViewIncidentInjuryDetail(caller, row)
      ? { injuryDetail: row.injuryDetail, investigationNotes: row.investigationNotes }
      : null
  }));
}

export async function listSafetyRoles() {
  return db
    .select({
      id: safetyRoles.id,
      employeeId: safetyRoles.employeeId,
      employeeName: employeeDisplayName,
      roleName: safetyRoles.roleName,
      certifiedOn: safetyRoles.certifiedOn,
      expiresOn: safetyRoles.expiresOn
    })
    .from(safetyRoles)
    .innerJoin(employees, eq(employees.id, safetyRoles.employeeId))
    .orderBy(safetyRoles.expiresOn);
}

// --- Recruitment ---

export async function listVacancies(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  // Everyone sees open vacancies — internal moves and referrals depend on it. Drafts and
  // closed roles are HR's working state and are not.
  const visibility =
    isHrAdmin(caller)
      ? undefined
      : or(eq(vacancies.status, 'open'), eq(vacancies.hiringManagerEmployeeId, caller.id));

  return db.select().from(vacancies).where(visibility).orderBy(desc(vacancies.createdAt));
}

export type ApplicationRow = {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  candidateName: string;
  candidateEmail: string;
  stage: (typeof jobApplications.stage.enumValues)[number];
  rating: number | null;
  appliedOn: string;
  convertedEmployeeId: string | null;
  interviewCount: number;
};

/**
 * Applications the caller may see: everything for HR, and their own vacancies' for a hiring
 * manager. Filtered per vacancy rather than globally, because entitlement depends on which
 * vacancy the application belongs to.
 */
export async function listApplications(caller: ActiveEmployee): Promise<ApplicationRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const rows = await db
    .select({
      id: jobApplications.id,
      vacancyId: jobApplications.vacancyId,
      vacancyTitle: vacancies.title,
      hiringManagerEmployeeId: vacancies.hiringManagerEmployeeId,
      candidateName: jobApplications.candidateName,
      candidateEmail: jobApplications.candidateEmail,
      stage: jobApplications.stage,
      rating: jobApplications.rating,
      appliedOn: jobApplications.appliedOn,
      convertedEmployeeId: jobApplications.convertedEmployeeId
    })
    .from(jobApplications)
    .innerJoin(vacancies, eq(vacancies.id, jobApplications.vacancyId))
    .orderBy(desc(jobApplications.appliedOn));

  const visible = rows.filter((row) =>
    canViewApplications(caller, { hiringManagerEmployeeId: row.hiringManagerEmployeeId })
  );

  if (visible.length === 0) return [];

  const interviewRows = await db
    .select({ applicationId: interviews.applicationId })
    .from(interviews);
  const counts = new Map<string, number>();
  for (const row of interviewRows) {
    counts.set(row.applicationId, (counts.get(row.applicationId) ?? 0) + 1);
  }

  return visible.map((row) => ({
    id: row.id,
    vacancyId: row.vacancyId,
    vacancyTitle: row.vacancyTitle,
    candidateName: row.candidateName,
    candidateEmail: row.candidateEmail,
    stage: row.stage,
    rating: row.rating,
    appliedOn: row.appliedOn,
    convertedEmployeeId: row.convertedEmployeeId,
    interviewCount: counts.get(row.id) ?? 0
  }));
}

/** Everyone the caller can assign training to or name in a safety record. */
export async function listGrowthSubjects(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  const visibility =
    hrScopeFor(caller) === 'all'
      ? undefined
      : or(eq(employees.id, caller.id), eq(employees.managerId, caller.id));

  const rows = await db
    .select({ id: employees.id, name: employeeDisplayName, managerId: employees.managerId })
    .from(employees)
    .where(and(ne(employees.status, 'disabled'), visibility));

  return rows
    .map((row) => ({
      ...row,
      isSelf: row.id === caller.id,
      isReport: isLineManagerOf(caller, row)
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
