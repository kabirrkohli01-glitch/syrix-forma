import { and, avg, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import {
  appraisals,
  companyGoals,
  deliverables,
  employees,
  hrDocumentAcknowledgements,
  hrDocuments,
  kudos,
  objectives,
  oneToOnes,
  surveyResponses,
  surveys
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canViewOneToOnePrivateNotes,
  hrScopeFor,
  isLineManagerOf
} from '@/lib/permissions/hr-access';

/**
 * Self plus direct reports; everyone for HR. The shape every HR list query uses.
 *
 * Takes the subject column rather than being written per table, so the four performance
 * queries cannot drift apart from each other — a visibility rule copy-pasted four times is a
 * visibility rule that will eventually be four different rules.
 */
function subjectVisibility(caller: ActiveEmployee, employeeIdColumn: AnyPgColumn) {
  if (hrScopeFor(caller) === 'all') return undefined;
  return or(eq(employeeIdColumn, caller.id), eq(employees.managerId, caller.id));
}

// --- Documents ---

export type HrDocumentRow = {
  id: string;
  title: string;
  description: string | null;
  visibility: 'company' | 'employee';
  employeeId: string | null;
  employeeName: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  requiresAcknowledgement: boolean;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

/**
 * Documents this caller may see: every company document, plus their own personal ones, plus
 * everyone's if they are HR.
 *
 * A line manager is deliberately absent from the personal branch. The employment band gives
 * them a job title and a start date; it does not give them their report's contract or
 * disciplinary correspondence, which is where the genuinely sensitive material lives.
 */
export async function listHrDocuments(caller: ActiveEmployee): Promise<HrDocumentRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const personal =
    hrScopeFor(caller) === 'all'
      ? eq(hrDocuments.visibility, 'employee')
      : and(eq(hrDocuments.visibility, 'employee'), eq(hrDocuments.employeeId, caller.id));

  const rows = await db
    .select({
      id: hrDocuments.id,
      title: hrDocuments.title,
      description: hrDocuments.description,
      visibility: hrDocuments.visibility,
      employeeId: hrDocuments.employeeId,
      employeeName: employeeDisplayName,
      fileName: hrDocuments.fileName,
      mimeType: hrDocuments.mimeType,
      sizeBytes: hrDocuments.sizeBytes,
      requiresAcknowledgement: hrDocuments.requiresAcknowledgement,
      acknowledgedAt: hrDocumentAcknowledgements.acknowledgedAt,
      createdAt: hrDocuments.createdAt
    })
    .from(hrDocuments)
    .leftJoin(employees, eq(employees.id, hrDocuments.employeeId))
    .leftJoin(
      hrDocumentAcknowledgements,
      and(
        eq(hrDocumentAcknowledgements.documentId, hrDocuments.id),
        eq(hrDocumentAcknowledgements.employeeId, caller.id)
      )
    )
    .where(and(isNull(hrDocuments.archivedAt), or(eq(hrDocuments.visibility, 'company'), personal)))
    .orderBy(desc(hrDocuments.createdAt));

  return rows;
}

/** How many of the audience have acknowledged — HR's completion tracking. */
export async function getAcknowledgementCounts(documentId: string) {
  const [[acknowledged], [audience]] = await Promise.all([
    db
      .select({ total: count() })
      .from(hrDocumentAcknowledgements)
      .where(eq(hrDocumentAcknowledgements.documentId, documentId)),
    db.select({ total: count() }).from(employees).where(eq(employees.status, 'active'))
  ]);
  return { acknowledged: acknowledged.total, audience: audience.total };
}

// --- Performance ---

export async function listCompanyGoals() {
  return db.select().from(companyGoals).orderBy(desc(companyGoals.createdAt));
}

export type ObjectiveRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  title: string;
  description: string | null;
  status: (typeof objectives.status.enumValues)[number];
  progressPercent: number;
  dueDate: string | null;
  companyGoalId: string | null;
  companyGoalTitle: string | null;
};

export async function listObjectives(caller: ActiveEmployee): Promise<ObjectiveRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select({
      id: objectives.id,
      employeeId: objectives.employeeId,
      employeeName: employeeDisplayName,
      title: objectives.title,
      description: objectives.description,
      status: objectives.status,
      progressPercent: objectives.progressPercent,
      dueDate: objectives.dueDate,
      companyGoalId: objectives.companyGoalId,
      companyGoalTitle: companyGoals.title
    })
    .from(objectives)
    .innerJoin(employees, eq(employees.id, objectives.employeeId))
    .leftJoin(companyGoals, eq(companyGoals.id, objectives.companyGoalId))
    .where(subjectVisibility(caller, objectives.employeeId))
    .orderBy(objectives.dueDate);
}

export type OneToOneRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  managerEmployeeId: string | null;
  heldOn: string;
  agenda: string | null;
  sharedNotes: string | null;
  /** Null when the caller may not see them — including when the caller is the subject. */
  privateNotes: string | null;
};

/**
 * One-to-ones, with the manager's private notes redacted per row.
 *
 * Redacted here rather than in the component for the same reason absence medical detail is:
 * entitlement depends on the row (who the manager was), not just on the caller, and a field
 * filtered out only in the markup has still been sent to the browser.
 */
export async function listOneToOnes(caller: ActiveEmployee): Promise<OneToOneRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const rows = await db
    .select({
      id: oneToOnes.id,
      employeeId: oneToOnes.employeeId,
      employeeName: employeeDisplayName,
      managerEmployeeId: oneToOnes.managerEmployeeId,
      heldOn: oneToOnes.heldOn,
      agenda: oneToOnes.agenda,
      sharedNotes: oneToOnes.sharedNotes,
      privateNotes: oneToOnes.privateNotes
    })
    .from(oneToOnes)
    .innerJoin(employees, eq(employees.id, oneToOnes.employeeId))
    .where(subjectVisibility(caller, oneToOnes.employeeId))
    .orderBy(desc(oneToOnes.heldOn));

  return rows.map((row) => ({
    ...row,
    privateNotes: canViewOneToOnePrivateNotes(caller, {
      employeeId: row.employeeId,
      managerEmployeeId: row.managerEmployeeId
    })
      ? row.privateNotes
      : null
  }));
}

export type AppraisalRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  managerEmployeeId: string | null;
  cycle: string;
  status: (typeof appraisals.status.enumValues)[number];
  selfReview: string | null;
  managerReview: string | null;
  rating: number | null;
  dueDate: string | null;
};

export async function listAppraisals(caller: ActiveEmployee): Promise<AppraisalRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select({
      id: appraisals.id,
      employeeId: appraisals.employeeId,
      employeeName: employeeDisplayName,
      managerEmployeeId: appraisals.managerEmployeeId,
      cycle: appraisals.cycle,
      status: appraisals.status,
      selfReview: appraisals.selfReview,
      managerReview: appraisals.managerReview,
      rating: appraisals.rating,
      dueDate: appraisals.dueDate
    })
    .from(appraisals)
    .innerJoin(employees, eq(employees.id, appraisals.employeeId))
    .where(subjectVisibility(caller, appraisals.employeeId))
    .orderBy(desc(appraisals.createdAt));
}

export async function listDeliverables(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select({
      id: deliverables.id,
      employeeId: deliverables.employeeId,
      employeeName: employeeDisplayName,
      title: deliverables.title,
      dueDate: deliverables.dueDate,
      completedAt: deliverables.completedAt,
      objectiveId: deliverables.objectiveId
    })
    .from(deliverables)
    .innerJoin(employees, eq(employees.id, deliverables.employeeId))
    .where(subjectVisibility(caller, deliverables.employeeId))
    .orderBy(deliverables.dueDate);
}

// --- Engagement ---

/**
 * The recognition wall. Company-wide by design — see the comment on the table.
 *
 * `employees` is joined twice, so the giver side needs an alias: without one the second join
 * would collide with the first and the query would silently return the recipient's name in
 * both columns.
 */
export async function listKudos(limit = 30) {
  const giver = alias(employees, 'kudos_giver');

  return db
    .select({
      id: kudos.id,
      message: kudos.message,
      createdAt: kudos.createdAt,
      toEmployeeId: kudos.toEmployeeId,
      toName: employeeDisplayName,
      fromName: giver.name
    })
    .from(kudos)
    .innerJoin(employees, eq(employees.id, kudos.toEmployeeId))
    .leftJoin(giver, eq(giver.id, kudos.fromEmployeeId))
    .orderBy(desc(kudos.createdAt))
    .limit(limit);
}

export async function listOpenSurveys() {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .select()
    .from(surveys)
    .where(
      and(
        or(isNull(surveys.opensOn), sql`${surveys.opensOn} <= ${today}`),
        or(isNull(surveys.closesOn), sql`${surveys.closesOn} >= ${today}`)
      )
    )
    .orderBy(desc(surveys.createdAt));
}

export type SurveyResult = {
  surveyId: string;
  title: string;
  question: string;
  isAnonymous: boolean;
  responseCount: number;
  averageScore: number | null;
  /** Standard eNPS: promoters (9-10) minus detractors (0-6), as a percentage. */
  enps: number | null;
};

/**
 * Aggregate results only.
 *
 * Even for HR, and even for a non-anonymous survey, this returns counts and scores rather than
 * per-person answers. For an anonymous survey the identity was never written in the first
 * place, so there is nothing to leak; returning the same shape for both means a survey cannot
 * accidentally become identifiable by being read through a different function.
 */
export async function getSurveyResults(surveyId: string): Promise<SurveyResult | null> {
  const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
  if (!survey) return null;

  const [[totals], bands] = await Promise.all([
    db
      .select({ total: count(), average: avg(surveyResponses.score) })
      .from(surveyResponses)
      .where(eq(surveyResponses.surveyId, surveyId)),
    db
      .select({ score: surveyResponses.score, total: count() })
      .from(surveyResponses)
      .where(eq(surveyResponses.surveyId, surveyId))
      .groupBy(surveyResponses.score)
  ]);

  const responseCount = totals.total;
  let enps: number | null = null;
  if (responseCount > 0) {
    const promoters = bands.filter((b) => b.score >= 9).reduce((sum, b) => sum + b.total, 0);
    const detractors = bands.filter((b) => b.score <= 6).reduce((sum, b) => sum + b.total, 0);
    enps = Math.round(((promoters - detractors) / responseCount) * 100);
  }

  return {
    surveyId: survey.id,
    title: survey.title,
    question: survey.question,
    isAnonymous: survey.isAnonymous,
    responseCount,
    averageScore: totals.average === null ? null : Number(totals.average),
    enps
  };
}

/** Everyone the caller may set objectives or hold a one-to-one for. */
export async function listPerformanceSubjects(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  const visibility =
    hrScopeFor(caller) === 'all'
      ? undefined
      : or(eq(employees.id, caller.id), eq(employees.managerId, caller.id));

  const rows = await db
    .select({ id: employees.id, name: employeeDisplayName, managerId: employees.managerId })
    .from(employees)
    .where(and(sql`${employees.status} <> 'disabled'`, visibility));

  return rows
    .map((row) => ({
      ...row,
      isSelf: row.id === caller.id,
      isReport: isLineManagerOf(caller, row)
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
