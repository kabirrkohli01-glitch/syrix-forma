'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  appraisals,
  companyGoals,
  deliverables,
  employees,
  kudos,
  objectives,
  oneToOnes,
  surveyResponses,
  surveys
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canGiveKudos,
  canManageCompanyGoals,
  canManageObjectives,
  canManageOneToOne,
  canManageSurveys,
  canRespondToSurvey,
  canWriteManagerReview,
  canWriteSelfReview
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

// --- Company goals ---

const companyGoalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  startDate: isoDateSchema.optional(),
  dueDate: isoDateSchema.optional()
});

export async function createCompanyGoal(input: z.input<typeof companyGoalSchema>) {
  const caller = await requireActiveEmployee();
  if (!canManageCompanyGoals(caller)) throw new HrError('Only HR can set company goals');
  const parsed = companyGoalSchema.parse(input);

  const [created] = await db
    .insert(companyGoals)
    .values({
      title: parsed.title,
      description: parsed.description ?? null,
      startDate: parsed.startDate ?? null,
      dueDate: parsed.dueDate ?? null,
      ownerEmployeeId: caller.id
    })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'company_goal_created',
    resourceType: 'company_goal',
    resourceId: created.id,
    result: 'success',
    metadata: { title: parsed.title }
  });

  revalidatePath('/dashboard/hr/performance');
  return { id: created.id };
}

// --- Objectives ---

const objectiveSchema = z.object({
  employeeId: z.uuid().optional(),
  companyGoalId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  dueDate: isoDateSchema.optional()
});

export async function createObjective(input: z.input<typeof objectiveSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = objectiveSchema.parse(input);
  const subject = await loadSubject(parsed.employeeId ?? caller.id);

  if (!canManageObjectives(caller, subject)) {
    throw new HrError('You cannot set objectives for that person');
  }

  const [created] = await db
    .insert(objectives)
    .values({
      employeeId: subject.id,
      companyGoalId: parsed.companyGoalId ?? null,
      title: parsed.title,
      description: parsed.description ?? null,
      dueDate: parsed.dueDate ?? null,
      createdByEmployeeId: caller.id
    })
    .returning();

  if (subject.id !== caller.id) {
    await createNotification({
      employeeId: subject.id,
      type: 'objective_set',
      title: 'A new objective was set for you',
      body: parsed.title,
      link: '/dashboard/hr/performance'
    });
  }

  revalidatePath('/dashboard/hr/performance');
  return { id: created.id };
}

const updateObjectiveSchema = z.object({
  objectiveId: z.uuid(),
  status: z.enum(['not_started', 'in_progress', 'achieved', 'missed', 'cancelled']).optional(),
  progressPercent: z.number().int().min(0).max(100).optional()
});

export async function updateObjective(input: z.input<typeof updateObjectiveSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = updateObjectiveSchema.parse(input);

  const [row] = await db
    .select()
    .from(objectives)
    .where(eq(objectives.id, parsed.objectiveId))
    .limit(1);
  if (!row) throw new HrError('That objective no longer exists');

  const subject = await loadSubject(row.employeeId);
  if (!canManageObjectives(caller, subject)) {
    throw new HrError('You cannot change that objective');
  }

  await db
    .update(objectives)
    .set({
      status: parsed.status ?? row.status,
      progressPercent: parsed.progressPercent ?? row.progressPercent,
      updatedAt: new Date()
    })
    .where(eq(objectives.id, row.id));

  revalidatePath('/dashboard/hr/performance');
}

const deliverableSchema = z.object({
  objectiveId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  dueDate: isoDateSchema.optional()
});

export async function createDeliverable(input: z.input<typeof deliverableSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = deliverableSchema.parse(input);
  const subject = await loadSubject(parsed.employeeId ?? caller.id);

  if (!canManageObjectives(caller, subject)) {
    throw new HrError('You cannot add deliverables for that person');
  }

  const [created] = await db
    .insert(deliverables)
    .values({
      objectiveId: parsed.objectiveId ?? null,
      employeeId: subject.id,
      title: parsed.title,
      dueDate: parsed.dueDate ?? null
    })
    .returning();

  revalidatePath('/dashboard/hr/performance');
  return { id: created.id };
}

export async function toggleDeliverable(input: { deliverableId: string }) {
  const caller = await requireActiveEmployee();
  const [row] = await db
    .select()
    .from(deliverables)
    .where(eq(deliverables.id, input.deliverableId))
    .limit(1);
  if (!row) throw new HrError('That deliverable no longer exists');

  const subject = await loadSubject(row.employeeId);
  if (!canManageObjectives(caller, subject)) {
    throw new HrError('You cannot change that deliverable');
  }

  await db
    .update(deliverables)
    .set({ completedAt: row.completedAt ? null : new Date() })
    .where(eq(deliverables.id, row.id));

  revalidatePath('/dashboard/hr/performance');
}

// --- One-to-ones ---

const oneToOneSchema = z.object({
  employeeId: z.uuid(),
  heldOn: isoDateSchema,
  agenda: z.string().trim().max(4000).optional(),
  sharedNotes: z.string().trim().max(8000).optional(),
  privateNotes: z.string().trim().max(8000).optional()
});

export async function recordOneToOne(input: z.input<typeof oneToOneSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = oneToOneSchema.parse(input);
  const subject = await loadSubject(parsed.employeeId);

  if (!canManageOneToOne(caller, subject)) {
    throw new HrError('You cannot record a one-to-one for that person');
  }

  const [created] = await db
    .insert(oneToOnes)
    .values({
      employeeId: subject.id,
      managerEmployeeId: caller.id,
      heldOn: parsed.heldOn,
      agenda: parsed.agenda ?? null,
      sharedNotes: parsed.sharedNotes ?? null,
      privateNotes: parsed.privateNotes ?? null
    })
    .returning();

  await createNotification({
    employeeId: subject.id,
    type: 'one_to_one_recorded',
    title: 'Your one-to-one was written up',
    body: `Held on ${parsed.heldOn}`,
    link: '/dashboard/hr/performance'
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'one_to_one_recorded',
    resourceType: 'one_to_one',
    resourceId: created.id,
    result: 'success',
    // Never the notes themselves — private notes in an audit log would defeat the boundary
    // that makes the field defensible in the first place.
    metadata: { subjectEmployeeId: subject.id, heldOn: parsed.heldOn }
  });

  revalidatePath('/dashboard/hr/performance');
  return { id: created.id };
}

// --- Appraisals ---

const startAppraisalSchema = z.object({
  employeeId: z.uuid(),
  cycle: z.string().trim().min(1).max(100),
  dueDate: isoDateSchema.optional()
});

export async function startAppraisal(input: z.input<typeof startAppraisalSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = startAppraisalSchema.parse(input);
  const subject = await loadSubject(parsed.employeeId);

  if (!canWriteManagerReview(caller, subject)) {
    throw new HrError('You cannot start an appraisal for that person');
  }

  const [created] = await db
    .insert(appraisals)
    .values({
      employeeId: subject.id,
      managerEmployeeId: caller.id,
      cycle: parsed.cycle,
      dueDate: parsed.dueDate ?? null,
      status: 'awaiting_self_review'
    })
    .onConflictDoNothing({ target: [appraisals.employeeId, appraisals.cycle] })
    .returning();

  if (!created) {
    throw new HrError(`${subject.name} already has an appraisal for ${parsed.cycle}`);
  }

  await createNotification({
    employeeId: subject.id,
    type: 'appraisal_started',
    title: `Your ${parsed.cycle} appraisal is open`,
    body: 'Write your self-review when you are ready.',
    link: '/dashboard/hr/performance'
  });

  revalidatePath('/dashboard/hr/performance');
  return { id: created.id };
}

const reviewSchema = z.object({
  appraisalId: z.uuid(),
  text: z.string().trim().min(1).max(20000),
  rating: z.number().int().min(1).max(5).optional()
});

export async function submitSelfReview(input: z.input<typeof reviewSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = reviewSchema.parse(input);

  const [row] = await db
    .select()
    .from(appraisals)
    .where(eq(appraisals.id, parsed.appraisalId))
    .limit(1);
  if (!row) throw new HrError('That appraisal no longer exists');

  const subject = await loadSubject(row.employeeId);
  if (!canWriteSelfReview(caller, subject)) {
    throw new HrError('Only the employee writes their own self-review');
  }

  await db
    .update(appraisals)
    .set({
      selfReview: parsed.text,
      selfReviewSubmittedAt: new Date(),
      status: 'awaiting_manager_review',
      updatedAt: new Date()
    })
    .where(eq(appraisals.id, row.id));

  if (row.managerEmployeeId) {
    await createNotification({
      employeeId: row.managerEmployeeId,
      type: 'self_review_submitted',
      title: `${subject.name} submitted their self-review`,
      body: row.cycle,
      link: '/dashboard/hr/performance'
    });
  }

  revalidatePath('/dashboard/hr/performance');
}

export async function submitManagerReview(input: z.input<typeof reviewSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = reviewSchema.parse(input);

  const [row] = await db
    .select()
    .from(appraisals)
    .where(eq(appraisals.id, parsed.appraisalId))
    .limit(1);
  if (!row) throw new HrError('That appraisal no longer exists');

  const subject = await loadSubject(row.employeeId);
  if (!canWriteManagerReview(caller, subject)) {
    throw new HrError('You cannot write the manager review for that person');
  }

  await db
    .update(appraisals)
    .set({
      managerReview: parsed.text,
      managerReviewSubmittedAt: new Date(),
      rating: parsed.rating ?? row.rating,
      status: 'complete',
      updatedAt: new Date()
    })
    .where(eq(appraisals.id, row.id));

  await createNotification({
    employeeId: subject.id,
    type: 'appraisal_complete',
    title: `Your ${row.cycle} appraisal is complete`,
    link: '/dashboard/hr/performance'
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'appraisal_completed',
    resourceType: 'appraisal',
    resourceId: row.id,
    result: 'success',
    metadata: { subjectEmployeeId: subject.id, cycle: row.cycle, rating: parsed.rating ?? null }
  });

  revalidatePath('/dashboard/hr/performance');
}

// --- Engagement ---

const kudosSchema = z.object({
  toEmployeeId: z.uuid(),
  message: z.string().trim().min(1).max(1000)
});

export async function giveKudos(input: z.input<typeof kudosSchema>) {
  const caller = await requireActiveEmployee();
  if (!canGiveKudos(caller)) throw new HrError('You cannot post recognition');
  const parsed = kudosSchema.parse(input);

  if (parsed.toEmployeeId === caller.id) {
    throw new HrError('Recognition is for other people');
  }

  const subject = await loadSubject(parsed.toEmployeeId);

  await db.insert(kudos).values({
    fromEmployeeId: caller.id,
    toEmployeeId: subject.id,
    message: parsed.message
  });

  await createNotification({
    employeeId: subject.id,
    type: 'kudos_received',
    title: `${caller.displayName} recognised your work`,
    body: parsed.message,
    link: '/dashboard/hr/performance'
  });

  revalidatePath('/dashboard/hr/performance');
}

const surveySchema = z.object({
  title: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(1000),
  isAnonymous: z.boolean().default(true),
  opensOn: isoDateSchema.optional(),
  closesOn: isoDateSchema.optional()
});

export async function createSurvey(input: z.input<typeof surveySchema>) {
  const caller = await requireActiveEmployee();
  if (!canManageSurveys(caller)) throw new HrError('Only HR can create surveys');
  const parsed = surveySchema.parse(input);

  const [created] = await db
    .insert(surveys)
    .values({
      title: parsed.title,
      question: parsed.question,
      isAnonymous: parsed.isAnonymous,
      opensOn: parsed.opensOn ?? null,
      closesOn: parsed.closesOn ?? null,
      createdByEmployeeId: caller.id
    })
    .returning();

  revalidatePath('/dashboard/hr/performance');
  return { id: created.id };
}

const respondSchema = z.object({
  surveyId: z.uuid(),
  score: z.number().int().min(0).max(10),
  comment: z.string().trim().max(2000).optional()
});

export async function respondToSurvey(input: z.input<typeof respondSchema>) {
  const caller = await requireActiveEmployee();
  if (!canRespondToSurvey(caller)) throw new HrError('You cannot respond to surveys');
  const parsed = respondSchema.parse(input);

  const [survey] = await db.select().from(surveys).where(eq(surveys.id, parsed.surveyId)).limit(1);
  if (!survey) throw new HrError('That survey no longer exists');

  await db.insert(surveyResponses).values({
    surveyId: survey.id,
    // The identity is simply not written for an anonymous survey. Writing it and filtering it
    // out on read would leave the link in the database, one careless select() away from
    // breaking the anonymity the survey promised.
    employeeId: survey.isAnonymous ? null : caller.id,
    score: parsed.score,
    comment: parsed.comment ?? null
  });

  // No audit entry for an anonymous response either: an audit row naming the actor alongside
  // the survey id would reconstruct exactly the link the null column refuses to store.
  if (!survey.isAnonymous) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'survey_responded',
      resourceType: 'survey',
      resourceId: survey.id,
      result: 'success',
      metadata: {}
    });
  }

  revalidatePath('/dashboard/hr/performance');
}
