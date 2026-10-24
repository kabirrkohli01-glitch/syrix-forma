'use server';

import { and, desc, eq, inArray, isNull, sum } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  clockEvents,
  employees,
  expenseCategories,
  expenseClaims,
  expenseItems,
  shifts,
  shiftSwapRequests,
  timesheetEntries,
  timesheets
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { calculateMileagePence, formatPence, poundsToPence } from '@/lib/hr/money';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canApproveExpenseClaim,
  canApproveShiftSwap,
  canApproveTimesheet,
  canClock,
  canEditExpenseClaim,
  canEditTimesheet,
  canManageRota,
  canMarkExpensePaid,
  canRequestShiftSwap
} from '@/lib/permissions/hr-access';
import { HrError } from './utils/errors';
import { isoDateSchema } from './utils/leave-schemas';
import { getMileageBands, milesClaimedInTaxYear, weekStartFor } from './utils/work-queries';

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

// --- Rota ---

const shiftSchema = z
  .object({
    employeeId: z.uuid(),
    onDate: isoDateSchema,
    startMinute: z.number().int().min(0).max(1439),
    // Beyond 1440 is allowed and meaningful: a shift that runs past midnight.
    endMinute: z.number().int().min(1).max(2879),
    unpaidBreakMinutes: z.number().int().min(0).max(480).default(0),
    templateName: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(1000).optional()
  })
  .refine((value) => value.endMinute > value.startMinute, {
    message: 'A shift has to end after it starts',
    path: ['endMinute']
  });

export async function createShift(input: z.input<typeof shiftSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = shiftSchema.parse(input);
  const subject = await loadSubject(parsed.employeeId);

  if (!canManageRota(caller, subject)) {
    throw new HrError('You cannot schedule shifts for that person');
  }

  const [created] = await db
    .insert(shifts)
    .values({
      employeeId: subject.id,
      onDate: parsed.onDate,
      startMinute: parsed.startMinute,
      endMinute: parsed.endMinute,
      unpaidBreakMinutes: parsed.unpaidBreakMinutes,
      templateName: parsed.templateName ?? null,
      notes: parsed.notes ?? null,
      createdByEmployeeId: caller.id
    })
    .returning();

  revalidatePath('/dashboard/hr/rotas');
  return { id: created.id };
}

/**
 * Publishing is a separate act from creating. A rota being drafted must not notify anyone —
 * people plan their lives around a published rota, and a half-built one that pings everybody
 * trains them to ignore it.
 */
export async function publishShifts(input: { shiftIds: string[] }) {
  const caller = await requireActiveEmployee();
  if (input.shiftIds.length === 0) return;

  const targets = await db
    .select({ id: shifts.id, employeeId: shifts.employeeId, onDate: shifts.onDate })
    .from(shifts)
    .where(and(inArray(shifts.id, input.shiftIds), isNull(shifts.publishedAt)));

  for (const row of targets) {
    const subject = await loadSubject(row.employeeId);
    if (!canManageRota(caller, subject)) {
      throw new HrError('You cannot publish shifts for that person');
    }
  }

  const now = new Date();
  for (const row of targets) {
    await db.update(shifts).set({ publishedAt: now }).where(eq(shifts.id, row.id));
    await createNotification({
      employeeId: row.employeeId,
      type: 'shift_published',
      title: 'Your rota was updated',
      body: `Shift on ${row.onDate}`,
      link: '/dashboard/hr/rotas'
    });
  }

  revalidatePath('/dashboard/hr/rotas');
}

export async function requestShiftSwap(input: {
  shiftId: string;
  offeredToEmployeeId?: string;
  note?: string;
}) {
  const caller = await requireActiveEmployee();

  const [shift] = await db.select().from(shifts).where(eq(shifts.id, input.shiftId)).limit(1);
  if (!shift) throw new HrError('That shift no longer exists');

  const subject = await loadSubject(shift.employeeId);
  if (!canRequestShiftSwap(caller, subject)) {
    throw new HrError('You can only offer your own shifts');
  }

  const [created] = await db
    .insert(shiftSwapRequests)
    .values({
      shiftId: shift.id,
      requestedByEmployeeId: caller.id,
      offeredToEmployeeId: input.offeredToEmployeeId ?? null,
      note: input.note?.trim() || null
    })
    .returning();

  if (input.offeredToEmployeeId) {
    await createNotification({
      employeeId: input.offeredToEmployeeId,
      type: 'shift_swap_offered',
      title: `${caller.displayName} asked you to cover a shift`,
      body: `On ${shift.onDate}`,
      link: '/dashboard/hr/rotas'
    });
  }

  revalidatePath('/dashboard/hr/rotas');
  return { id: created.id };
}

export async function acceptShiftSwap(input: { swapId: string }) {
  const caller = await requireActiveEmployee();

  const [swap] = await db
    .select()
    .from(shiftSwapRequests)
    .where(eq(shiftSwapRequests.id, input.swapId))
    .limit(1);
  if (!swap) throw new HrError('That swap request no longer exists');
  if (swap.status !== 'pending') throw new HrError(`That request has already been ${swap.status}`);
  if (swap.requestedByEmployeeId === caller.id) {
    throw new HrError('You cannot take your own shift back this way — cancel the request instead');
  }
  if (swap.offeredToEmployeeId && swap.offeredToEmployeeId !== caller.id) {
    throw new HrError('That shift was offered to someone else');
  }

  await db
    .update(shiftSwapRequests)
    .set({ status: 'accepted', acceptedByEmployeeId: caller.id, updatedAt: new Date() })
    .where(eq(shiftSwapRequests.id, swap.id));

  // The rota does not move yet. A manager still has to approve — see canApproveShiftSwap.
  const requester = await loadSubject(swap.requestedByEmployeeId);
  if (requester.managerId) {
    await createNotification({
      employeeId: requester.managerId,
      type: 'shift_swap_awaiting_approval',
      title: `${caller.displayName} agreed to cover ${requester.name}'s shift`,
      body: 'Waiting for your approval before the rota changes.',
      link: '/dashboard/hr/rotas'
    });
  }

  revalidatePath('/dashboard/hr/rotas');
}

export async function approveShiftSwap(input: { swapId: string }) {
  const caller = await requireActiveEmployee();

  const [swap] = await db
    .select()
    .from(shiftSwapRequests)
    .where(eq(shiftSwapRequests.id, input.swapId))
    .limit(1);
  if (!swap) throw new HrError('That swap request no longer exists');
  if (swap.status !== 'accepted') {
    throw new HrError('Nobody has agreed to cover that shift yet');
  }

  const requester = await loadSubject(swap.requestedByEmployeeId);
  if (!canApproveShiftSwap(caller, swap, requester.managerId)) {
    throw new HrError('You cannot approve that swap');
  }

  // Only now does the rota actually change.
  await db
    .update(shifts)
    .set({ employeeId: swap.acceptedByEmployeeId! })
    .where(eq(shifts.id, swap.shiftId));

  await db
    .update(shiftSwapRequests)
    .set({ status: 'approved', approvedByEmployeeId: caller.id, updatedAt: new Date() })
    .where(eq(shiftSwapRequests.id, swap.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'shift_swap_approved',
    resourceType: 'shift',
    resourceId: swap.shiftId,
    result: 'success',
    metadata: { from: swap.requestedByEmployeeId, to: swap.acceptedByEmployeeId }
  });

  revalidatePath('/dashboard/hr/rotas');
}

// --- Timesheets ---

const timesheetEntrySchema = z.object({
  onDate: isoDateSchema,
  minutes: z.number().int().min(0).max(1440),
  projectId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  isBillable: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional()
});

/** Adds an entry, creating that week's sheet on first use so nobody has to "open" one. */
export async function addTimesheetEntry(
  input: z.input<typeof timesheetEntrySchema> & { employeeId?: string }
) {
  const caller = await requireActiveEmployee();
  const parsed = timesheetEntrySchema.parse(input);
  const subject = await loadSubject(input.employeeId ?? caller.id);

  if (!canEditTimesheet(caller, subject)) {
    throw new HrError('You cannot record hours for that person');
  }

  const weekStart = weekStartFor(parsed.onDate);

  const [sheet] = await db
    .insert(timesheets)
    .values({ employeeId: subject.id, weekStart })
    .onConflictDoUpdate({
      target: [timesheets.employeeId, timesheets.weekStart],
      set: { updatedAt: new Date() }
    })
    .returning();

  if (sheet.status === 'approved') {
    throw new HrError('That week has already been approved. Ask your manager to reopen it.');
  }

  await db.insert(timesheetEntries).values({
    timesheetId: sheet.id,
    onDate: parsed.onDate,
    minutes: parsed.minutes,
    projectId: parsed.projectId ?? null,
    clientId: parsed.clientId ?? null,
    isBillable: parsed.isBillable,
    notes: parsed.notes ?? null
  });

  revalidatePath('/dashboard/hr/rotas');
  return { timesheetId: sheet.id };
}

export async function submitTimesheet(input: { timesheetId: string }) {
  const caller = await requireActiveEmployee();

  const [sheet] = await db
    .select()
    .from(timesheets)
    .where(eq(timesheets.id, input.timesheetId))
    .limit(1);
  if (!sheet) throw new HrError('That timesheet no longer exists');

  const subject = await loadSubject(sheet.employeeId);
  if (!canEditTimesheet(caller, subject)) {
    throw new HrError('You cannot submit that timesheet');
  }
  if (sheet.status === 'approved') throw new HrError('That timesheet is already approved');

  await db
    .update(timesheets)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(timesheets.id, sheet.id));

  if (subject.managerId) {
    await createNotification({
      employeeId: subject.managerId,
      type: 'timesheet_submitted',
      title: `${subject.name} submitted their timesheet`,
      body: `Week beginning ${sheet.weekStart}`,
      link: '/dashboard/hr/rotas'
    });
  }

  revalidatePath('/dashboard/hr/rotas');
}

export async function decideTimesheet(input: {
  timesheetId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}) {
  const caller = await requireActiveEmployee();

  const [sheet] = await db
    .select()
    .from(timesheets)
    .where(eq(timesheets.id, input.timesheetId))
    .limit(1);
  if (!sheet) throw new HrError('That timesheet no longer exists');
  if (sheet.status !== 'submitted') {
    throw new HrError('That timesheet has not been submitted for approval');
  }

  const subject = await loadSubject(sheet.employeeId);
  if (!canApproveTimesheet(caller, subject)) {
    throw new HrError('You cannot decide that timesheet');
  }

  await db
    .update(timesheets)
    .set({
      status: input.decision,
      decidedByEmployeeId: caller.id,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
      updatedAt: new Date()
    })
    .where(eq(timesheets.id, sheet.id));

  await createNotification({
    employeeId: sheet.employeeId,
    type: `timesheet_${input.decision}`,
    title: `Your timesheet was ${input.decision}`,
    body: `Week beginning ${sheet.weekStart}`,
    link: '/dashboard/hr/rotas'
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: `timesheet_${input.decision}`,
    resourceType: 'timesheet',
    resourceId: sheet.id,
    result: 'success',
    metadata: { subjectEmployeeId: sheet.employeeId, weekStart: sheet.weekStart }
  });

  revalidatePath('/dashboard/hr/rotas');
}

// --- Clocking ---

/**
 * Records a clock event for the caller, and only the caller.
 *
 * Deliberately records no location. See the comment on `clock_events` in schema.ts: geo-
 * tracking staff needs a DPIA and consultation, and is a separate decision rather than a
 * feature to add because a competitor has it.
 */
export async function clock(input: { eventType: 'in' | 'out' | 'break_start' | 'break_end' }) {
  const caller = await requireActiveEmployee();
  if (!canClock(caller, { id: caller.id, managerId: caller.managerId })) {
    throw new HrError('You cannot clock in or out');
  }

  // Newest first — ascending order here would test the transition against the caller's very
  // first clock event ever, so every state check after day one would be wrong.
  const [latest] = await db
    .select({ eventType: clockEvents.eventType })
    .from(clockEvents)
    .where(eq(clockEvents.employeeId, caller.id))
    .orderBy(desc(clockEvents.occurredAt))
    .limit(1);

  // Reject the transitions that cannot happen, rather than storing a sequence that cannot be
  // paired on read — two consecutive clock-ins make the day's hours unanswerable.
  const last = latest?.eventType;
  const isClockedIn = last === 'in' || last === 'break_end';
  if (input.eventType === 'in' && isClockedIn) throw new HrError('You are already clocked in');
  if (input.eventType === 'out' && !isClockedIn) throw new HrError('You are not clocked in');
  if (input.eventType === 'break_start' && !isClockedIn) {
    throw new HrError('Clock in before starting a break');
  }
  if (input.eventType === 'break_end' && last !== 'break_start') {
    throw new HrError('You are not on a break');
  }

  await db.insert(clockEvents).values({ employeeId: caller.id, eventType: input.eventType });
  revalidatePath('/dashboard/hr/rotas');
}

// --- Expenses ---

export async function createExpenseClaim(input: { title: string }) {
  const caller = await requireActiveEmployee();
  const title = z.string().trim().min(1).max(200).parse(input.title);

  const [created] = await db
    .insert(expenseClaims)
    .values({ employeeId: caller.id, title })
    .returning();

  revalidatePath('/dashboard/hr/expenses');
  return { id: created.id };
}

const expenseItemSchema = z.object({
  claimId: z.uuid(),
  categoryId: z.uuid().optional(),
  description: z.string().trim().min(1).max(500),
  spentOn: isoDateSchema,
  // Either an amount in pounds, or a mileage distance — never both.
  amount: z.string().trim().optional(),
  miles: z.number().int().min(1).max(10_000).optional(),
  clientId: z.uuid().optional(),
  projectId: z.uuid().optional()
});

export async function addExpenseItem(input: z.input<typeof expenseItemSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = expenseItemSchema.parse(input);

  const [claim] = await db
    .select()
    .from(expenseClaims)
    .where(eq(expenseClaims.id, parsed.claimId))
    .limit(1);
  if (!claim) throw new HrError('That claim no longer exists');

  const subject = await loadSubject(claim.employeeId);
  if (!canEditExpenseClaim(caller, subject)) {
    throw new HrError('You cannot add to that claim');
  }
  if (claim.status !== 'draft') {
    throw new HrError('That claim has already been submitted');
  }

  let amountPence: number;
  let pencePerMileUsed: number | null = null;

  if (parsed.miles !== undefined) {
    // Mileage is calculated here, never accepted from the client: the rate depends on how far
    // the employee has already travelled this tax year, which the browser cannot know and
    // must not be trusted to assert.
    const [bands, alreadyClaimed] = await Promise.all([
      getMileageBands(parsed.spentOn),
      milesClaimedInTaxYear(claim.employeeId, parsed.spentOn)
    ]);
    amountPence = calculateMileagePence({
      miles: parsed.miles,
      milesAlreadyClaimed: alreadyClaimed,
      bands
    });
    pencePerMileUsed = Math.round(amountPence / parsed.miles);
  } else if (parsed.amount) {
    amountPence = poundsToPence(parsed.amount);
    if (amountPence <= 0) throw new HrError('An expense has to be more than nothing');
  } else {
    throw new HrError('Enter an amount or a mileage distance');
  }

  if (parsed.categoryId) {
    const [category] = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.id, parsed.categoryId))
      .limit(1);

    if (category?.blockOverPence && amountPence > category.blockOverPence) {
      throw new HrError(
        `${category.name} is capped at ${formatPence(category.blockOverPence)} per item`
      );
    }
  }

  await db.insert(expenseItems).values({
    claimId: claim.id,
    categoryId: parsed.categoryId ?? null,
    description: parsed.description,
    spentOn: parsed.spentOn,
    amountPence,
    miles: parsed.miles ?? null,
    pencePerMileUsed,
    clientId: parsed.clientId ?? null,
    projectId: parsed.projectId ?? null
  });

  await recalculateClaimTotal(claim.id);
  revalidatePath('/dashboard/hr/expenses');
  return { amountPence };
}

/** Keeps the denormalised claim total honest. Called after every item change. */
async function recalculateClaimTotal(claimId: string) {
  const [row] = await db
    .select({ total: sum(expenseItems.amountPence) })
    .from(expenseItems)
    .where(eq(expenseItems.claimId, claimId));

  await db
    .update(expenseClaims)
    .set({ totalPence: Number(row.total ?? 0), updatedAt: new Date() })
    .where(eq(expenseClaims.id, claimId));
}

export async function submitExpenseClaim(input: { claimId: string }) {
  const caller = await requireActiveEmployee();

  const [claim] = await db
    .select()
    .from(expenseClaims)
    .where(eq(expenseClaims.id, input.claimId))
    .limit(1);
  if (!claim) throw new HrError('That claim no longer exists');

  const subject = await loadSubject(claim.employeeId);
  if (!canEditExpenseClaim(caller, subject)) throw new HrError('That claim is not yours');
  if (claim.status !== 'draft') throw new HrError('That claim has already been submitted');
  if (claim.totalPence <= 0) throw new HrError('Add at least one item before submitting');

  await db
    .update(expenseClaims)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(expenseClaims.id, claim.id));

  if (subject.managerId) {
    await createNotification({
      employeeId: subject.managerId,
      type: 'expense_claim_submitted',
      title: `${subject.name} submitted an expense claim`,
      body: `${claim.title} — ${formatPence(claim.totalPence, claim.currency)}`,
      link: '/dashboard/hr/expenses'
    });
  }

  revalidatePath('/dashboard/hr/expenses');
}

export async function decideExpenseClaim(input: {
  claimId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}) {
  const caller = await requireActiveEmployee();

  const [claim] = await db
    .select()
    .from(expenseClaims)
    .where(eq(expenseClaims.id, input.claimId))
    .limit(1);
  if (!claim) throw new HrError('That claim no longer exists');
  if (claim.status !== 'submitted') {
    throw new HrError('That claim is not awaiting a decision');
  }

  const subject = await loadSubject(claim.employeeId);
  if (!canApproveExpenseClaim(caller, subject)) {
    throw new HrError('You cannot decide that claim');
  }

  await db
    .update(expenseClaims)
    .set({
      status: input.decision,
      decidedByEmployeeId: caller.id,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
      updatedAt: new Date()
    })
    .where(eq(expenseClaims.id, claim.id));

  await createNotification({
    employeeId: claim.employeeId,
    type: `expense_claim_${input.decision}`,
    title: `Your expense claim was ${input.decision}`,
    body: `${claim.title} — ${formatPence(claim.totalPence, claim.currency)}`,
    link: '/dashboard/hr/expenses'
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: `expense_claim_${input.decision}`,
    resourceType: 'expense_claim',
    resourceId: claim.id,
    result: 'success',
    metadata: { subjectEmployeeId: claim.employeeId, totalPence: claim.totalPence }
  });

  revalidatePath('/dashboard/hr/expenses');
}

/**
 * Marks an approved claim as paid. Separate from approving it, and gated on finance rather
 * than on management: approval says the spend was legitimate, payment says money moved, and
 * one person doing both unchecked is the classic expenses control gap.
 */
export async function markExpenseClaimPaid(input: { claimId: string }) {
  const caller = await requireActiveEmployee();
  if (!canMarkExpensePaid(caller)) {
    throw new HrError('Only finance can mark a claim as paid');
  }

  const [claim] = await db
    .select()
    .from(expenseClaims)
    .where(eq(expenseClaims.id, input.claimId))
    .limit(1);
  if (!claim) throw new HrError('That claim no longer exists');
  if (claim.status !== 'approved') {
    throw new HrError('Only an approved claim can be marked as paid');
  }

  await db
    .update(expenseClaims)
    .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
    .where(eq(expenseClaims.id, claim.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'expense_claim_paid',
    resourceType: 'expense_claim',
    resourceId: claim.id,
    result: 'success',
    metadata: { subjectEmployeeId: claim.employeeId, totalPence: claim.totalPence }
  });

  revalidatePath('/dashboard/hr/expenses');
}
