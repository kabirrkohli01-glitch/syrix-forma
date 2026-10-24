'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  courseEnrolments,
  courses,
  employees,
  incidents,
  jobApplications,
  riskAssessments,
  safetyRoles,
  vacancies
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { isHrAdminRow } from '@/lib/db/hr-admin';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canAssignCourse,
  canConvertApplicantToEmployee,
  canInvestigateIncident,
  canManageApplications,
  canManageCourses,
  canManageRiskAssessments,
  canManageVacancies,
  canReportIncident,
  canUpdateOwnEnrolment
} from '@/lib/permissions/hr-access';
import { HrError } from './utils/errors';
import { isoDateSchema } from './utils/leave-schemas';

async function loadSubject(employeeId: string) {
  const [row] = await db
    .select({
      id: employees.id,
      name: employeeDisplayName,
      managerId: employees.managerId,
      status: employees.status
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!row || row.status === 'disabled') {
    throw new HrError('That employee record is not available');
  }
  return row;
}

/** Adds `months` to an ISO date, clamping to the end of a shorter target month. */
function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  // 31 January plus one month is 28 or 29 February, not 3 March.
  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDayOfTarget))
  )
    .toISOString()
    .slice(0, 10);
}

// --- Learning ---

const courseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  provider: z.string().trim().max(200).optional(),
  externalUrl: z.url().optional(),
  estimatedMinutes: z.number().int().min(1).max(10_000).optional(),
  validForMonths: z.number().int().min(1).max(120).optional()
});

export async function createCourse(input: z.input<typeof courseSchema>) {
  const caller = await requireActiveEmployee();
  if (!canManageCourses(caller)) throw new HrError('Only HR can add courses');
  const parsed = courseSchema.parse(input);

  const [created] = await db
    .insert(courses)
    .values({
      title: parsed.title,
      description: parsed.description ?? null,
      provider: parsed.provider ?? null,
      externalUrl: parsed.externalUrl ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
      validForMonths: parsed.validForMonths ?? null
    })
    .returning();

  revalidatePath('/dashboard/hr/learning');
  return { id: created.id };
}

export async function assignCourse(input: {
  courseId: string;
  employeeId?: string;
  dueOn?: string;
}) {
  const caller = await requireActiveEmployee();
  const subject = await loadSubject(input.employeeId ?? caller.id);

  if (!canAssignCourse(caller, subject)) {
    throw new HrError('You cannot assign training to that person');
  }

  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
  if (!course || course.archivedAt) throw new HrError('That course is not available');

  const [created] = await db
    .insert(courseEnrolments)
    .values({
      courseId: course.id,
      employeeId: subject.id,
      dueOn: input.dueOn ?? null,
      assignedByEmployeeId: caller.id
    })
    // Re-assigning something already assigned updates the due date rather than erroring.
    .onConflictDoUpdate({
      target: [courseEnrolments.courseId, courseEnrolments.employeeId],
      set: { dueOn: input.dueOn ?? null, updatedAt: new Date() }
    })
    .returning();

  if (subject.id !== caller.id) {
    await createNotification({
      employeeId: subject.id,
      type: 'course_assigned',
      title: `You were assigned "${course.title}"`,
      body: input.dueOn ? `Due ${input.dueOn}` : undefined,
      link: '/dashboard/hr/learning'
    });
  }

  revalidatePath('/dashboard/hr/learning');
  return { id: created.id };
}

export async function updateEnrolmentProgress(input: {
  enrolmentId: string;
  progressPercent: number;
}) {
  const caller = await requireActiveEmployee();
  const progress = z.number().int().min(0).max(100).parse(input.progressPercent);

  const [enrolment] = await db
    .select()
    .from(courseEnrolments)
    .where(eq(courseEnrolments.id, input.enrolmentId))
    .limit(1);
  if (!enrolment) throw new HrError('That enrolment no longer exists');

  const subject = await loadSubject(enrolment.employeeId);
  if (!canUpdateOwnEnrolment(caller, subject)) {
    throw new HrError('Only the learner records their own progress');
  }

  const completed = progress >= 100;
  const completedOn = completed ? new Date().toISOString().slice(0, 10) : null;

  let expiresOn: string | null = null;
  if (completed) {
    const [course] = await db
      .select({ validForMonths: courses.validForMonths })
      .from(courses)
      .where(eq(courses.id, enrolment.courseId))
      .limit(1);
    // Computed once at completion and stored, so later editing the course's validity does not
    // retroactively expire or revive somebody's certificate.
    if (course?.validForMonths && completedOn) {
      expiresOn = addMonths(completedOn, course.validForMonths);
    }
  }

  await db
    .update(courseEnrolments)
    .set({
      progressPercent: progress,
      status: completed ? 'completed' : progress > 0 ? 'in_progress' : 'assigned',
      completedOn,
      expiresOn,
      updatedAt: new Date()
    })
    .where(eq(courseEnrolments.id, enrolment.id));

  revalidatePath('/dashboard/hr/learning');
}

// --- Health and safety ---

const riskAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  hazard: z.string().trim().min(1).max(2000),
  whoIsAtRisk: z.string().trim().max(2000).optional(),
  existingControls: z.string().trim().max(4000).optional(),
  furtherActionNeeded: z.string().trim().max(4000).optional(),
  likelihood: z.number().int().min(1).max(5),
  severity: z.number().int().min(1).max(5),
  assessedOn: isoDateSchema,
  reviewDueOn: isoDateSchema.optional()
});

export async function createRiskAssessment(input: z.input<typeof riskAssessmentSchema>) {
  const caller = await requireActiveEmployee();
  if (!canManageRiskAssessments(caller)) {
    throw new HrError('Only HR can record a risk assessment');
  }
  const parsed = riskAssessmentSchema.parse(input);

  // Banded from likelihood × severity on a 1-25 scale. Derived at write time so the stored
  // level cannot disagree with the two numbers it came from.
  const score = parsed.likelihood * parsed.severity;
  const level = score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low';

  const [created] = await db
    .insert(riskAssessments)
    .values({
      title: parsed.title,
      location: parsed.location ?? null,
      hazard: parsed.hazard,
      whoIsAtRisk: parsed.whoIsAtRisk ?? null,
      existingControls: parsed.existingControls ?? null,
      furtherActionNeeded: parsed.furtherActionNeeded ?? null,
      likelihood: parsed.likelihood,
      severity: parsed.severity,
      level,
      assessedByEmployeeId: caller.id,
      assessedOn: parsed.assessedOn,
      reviewDueOn: parsed.reviewDueOn ?? null
    })
    .returning();

  revalidatePath('/dashboard/hr/safety');
  return { id: created.id, level };
}

const incidentSchema = z.object({
  kind: z.enum(['accident', 'near_miss', 'hazard', 'dangerous_occurrence', 'ill_health']),
  occurredAt: z.string().min(1),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1).max(4000),
  affectedEmployeeId: z.uuid().optional(),
  injuryDetail: z.string().trim().max(4000).optional(),
  immediateAction: z.string().trim().max(4000).optional()
});

export async function reportIncident(input: z.input<typeof incidentSchema>) {
  const caller = await requireActiveEmployee();
  if (!canReportIncident(caller)) throw new HrError('You cannot report an incident');
  const parsed = incidentSchema.parse(input);

  const occurredAt = new Date(parsed.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new HrError('That is not a valid date and time');

  const [created] = await db
    .insert(incidents)
    .values({
      kind: parsed.kind,
      occurredAt,
      location: parsed.location ?? null,
      description: parsed.description,
      affectedEmployeeId: parsed.affectedEmployeeId ?? null,
      injuryDetail: parsed.injuryDetail ?? null,
      immediateAction: parsed.immediateAction ?? null,
      reportedByEmployeeId: caller.id
      // riddorReportable is deliberately not set here. Whether an incident is reportable under
      // RIDDOR is a legal judgement with a deadline, and software guessing it would be worse
      // than software asking — HR sets it during investigation.
    })
    .returning();

  // Every HR administrator is told, because an unreviewed incident log is the failure mode
  // safety systems actually have.
  const hrAdmins = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(isHrAdminRow, eq(employees.status, 'active')));

  for (const admin of hrAdmins) {
    await createNotification({
      employeeId: admin.id,
      type: 'incident_reported',
      title: `${parsed.kind.replaceAll('_', ' ')} reported`,
      body: parsed.location ? `At ${parsed.location}` : undefined,
      link: '/dashboard/hr/safety'
    });
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'incident_reported',
    resourceType: 'incident',
    resourceId: created.id,
    result: 'success',
    // Kind and location only — injury detail is health data and does not belong in a log
    // SECURITY_ADMIN can read.
    metadata: { kind: parsed.kind, location: parsed.location ?? null }
  });

  revalidatePath('/dashboard/hr/safety');
  return { id: created.id };
}

export async function updateIncidentInvestigation(input: {
  incidentId: string;
  investigationNotes?: string;
  riddorReportable?: boolean;
  riddorReportedOn?: string;
  close?: boolean;
}) {
  const caller = await requireActiveEmployee();
  if (!canInvestigateIncident(caller)) {
    throw new HrError('Only HR can update an investigation');
  }

  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, input.incidentId))
    .limit(1);
  if (!incident) throw new HrError('That incident no longer exists');

  await db
    .update(incidents)
    .set({
      investigationNotes: input.investigationNotes ?? incident.investigationNotes,
      riddorReportable: input.riddorReportable ?? incident.riddorReportable,
      riddorReportedOn: input.riddorReportedOn ?? incident.riddorReportedOn,
      closedAt: input.close ? new Date() : incident.closedAt,
      updatedAt: new Date()
    })
    .where(eq(incidents.id, incident.id));

  revalidatePath('/dashboard/hr/safety');
}

export async function recordSafetyRole(input: {
  employeeId: string;
  roleName: string;
  certifiedOn?: string;
  expiresOn?: string;
}) {
  const caller = await requireActiveEmployee();
  if (!canManageRiskAssessments(caller)) {
    throw new HrError('Only HR can record safety roles');
  }
  const subject = await loadSubject(input.employeeId);

  await db.insert(safetyRoles).values({
    employeeId: subject.id,
    roleName: z.string().trim().min(1).max(200).parse(input.roleName),
    certifiedOn: input.certifiedOn ?? null,
    expiresOn: input.expiresOn ?? null
  });

  revalidatePath('/dashboard/hr/safety');
}

// --- Recruitment ---

const vacancySchema = z.object({
  title: z.string().trim().min(1).max(200),
  team: z.string().trim().max(100).optional(),
  description: z.string().trim().max(8000).optional(),
  location: z.string().trim().max(200).optional(),
  hiringManagerEmployeeId: z.uuid().optional(),
  closesOn: isoDateSchema.optional()
});

export async function createVacancy(input: z.input<typeof vacancySchema>) {
  const caller = await requireActiveEmployee();
  if (!canManageVacancies(caller)) throw new HrError('Only HR can open a vacancy');
  const parsed = vacancySchema.parse(input);

  const [created] = await db
    .insert(vacancies)
    .values({
      title: parsed.title,
      team: parsed.team ?? null,
      description: parsed.description ?? null,
      location: parsed.location ?? null,
      hiringManagerEmployeeId: parsed.hiringManagerEmployeeId ?? caller.id,
      closesOn: parsed.closesOn ?? null,
      status: 'open'
    })
    .returning();

  revalidatePath('/dashboard/hr/hiring');
  return { id: created.id };
}

const applicationSchema = z.object({
  vacancyId: z.uuid(),
  candidateName: z.string().trim().min(1).max(200),
  candidateEmail: z.email(),
  candidatePhone: z.string().trim().max(50).optional(),
  coverNote: z.string().trim().max(8000).optional(),
  appliedOn: isoDateSchema
});

export async function recordApplication(input: z.input<typeof applicationSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = applicationSchema.parse(input);

  const [vacancy] = await db
    .select()
    .from(vacancies)
    .where(eq(vacancies.id, parsed.vacancyId))
    .limit(1);
  if (!vacancy) throw new HrError('That vacancy no longer exists');
  if (!canManageApplications(caller, vacancy)) {
    throw new HrError('You cannot add candidates to that vacancy');
  }

  const [created] = await db
    .insert(jobApplications)
    .values({
      vacancyId: vacancy.id,
      candidateName: parsed.candidateName,
      candidateEmail: parsed.candidateEmail,
      candidatePhone: parsed.candidatePhone ?? null,
      coverNote: parsed.coverNote ?? null,
      appliedOn: parsed.appliedOn
    })
    .onConflictDoNothing({ target: [jobApplications.vacancyId, jobApplications.candidateEmail] })
    .returning();

  if (!created) {
    throw new HrError('That candidate has already applied for this vacancy');
  }

  revalidatePath('/dashboard/hr/hiring');
  return { id: created.id };
}

export async function moveApplicationStage(input: {
  applicationId: string;
  stage:
    | 'applied'
    | 'shortlisted'
    | 'interviewing'
    | 'offered'
    | 'hired'
    | 'rejected'
    | 'withdrawn';
  rating?: number;
}) {
  const caller = await requireActiveEmployee();

  const [application] = await db
    .select()
    .from(jobApplications)
    .where(eq(jobApplications.id, input.applicationId))
    .limit(1);
  if (!application) throw new HrError('That application no longer exists');

  const [vacancy] = await db
    .select()
    .from(vacancies)
    .where(eq(vacancies.id, application.vacancyId))
    .limit(1);
  if (!vacancy || !canManageApplications(caller, vacancy)) {
    throw new HrError('You cannot change that application');
  }

  await db
    .update(jobApplications)
    .set({
      stage: input.stage,
      rating: input.rating ?? application.rating,
      updatedAt: new Date()
    })
    .where(eq(jobApplications.id, application.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'application_stage_changed',
    resourceType: 'job_application',
    resourceId: application.id,
    result: 'success',
    metadata: { from: application.stage, to: input.stage }
  });

  revalidatePath('/dashboard/hr/hiring');
}

/**
 * Turns a hired candidate into a pending employee record.
 *
 * Deliberately an explicit act rather than a side effect of moving the stage to "hired".
 * Creating an employee record has payroll and access consequences, and those should follow a
 * decision somebody made on purpose. The new row is `pending` with no role, so it goes
 * through the same approval path as any other new starter (lib/onboarding/) rather than
 * arriving with permissions already attached.
 */
export async function convertApplicantToEmployee(input: { applicationId: string }) {
  const caller = await requireActiveEmployee();
  if (!canConvertApplicantToEmployee(caller)) {
    throw new HrError('Only HR can create an employee record');
  }

  const [application] = await db
    .select()
    .from(jobApplications)
    .where(eq(jobApplications.id, input.applicationId))
    .limit(1);
  if (!application) throw new HrError('That application no longer exists');
  if (application.stage !== 'hired') {
    throw new HrError('Move the candidate to hired first');
  }
  if (application.convertedEmployeeId) {
    throw new HrError('An employee record already exists for that candidate');
  }

  const [existing] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.email, application.candidateEmail))
    .limit(1);
  if (existing) {
    throw new HrError('Somebody with that email address is already on the system');
  }

  const [created] = await db
    .insert(employees)
    .values({
      // No Clerk account exists yet — one is created when they first sign in, and the
      // onboarding path links it by email. A placeholder keeps the not-null unique constraint
      // satisfied without pretending an account exists.
      clerkUserId: `pending_hire_${application.id}`,
      name: application.candidateName,
      email: application.candidateEmail,
      status: 'pending'
    })
    .returning({ id: employees.id });

  await db
    .update(jobApplications)
    .set({ convertedEmployeeId: created.id, updatedAt: new Date() })
    .where(eq(jobApplications.id, application.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'applicant_converted_to_employee',
    resourceType: 'employee',
    resourceId: created.id,
    result: 'success',
    metadata: { applicationId: application.id }
  });

  revalidatePath('/dashboard/hr/hiring');
  revalidatePath('/dashboard/hr');
  return { employeeId: created.id };
}
