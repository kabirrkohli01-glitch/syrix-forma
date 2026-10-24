'use server';

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { calendarEvents, employees, leaveRequests, leaveTypes } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { isHrAdminRow } from '@/lib/db/hr-admin';
import { calculateLeaveHalfDays, formatHalfDays } from '@/lib/hr/leave-calculation';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canCancelLeaveRequest,
  canDecideLeaveRequest,
  canRequestLeaveFor,
  canViewLeaveRequest
} from '@/lib/permissions/hr-access';
import { HrError } from './utils/errors';
import { getLeaveBalance, getLeaveSettings, getPublicHolidayDates } from './utils/leave-queries';
import {
  cancelLeaveSchema,
  decideLeaveSchema,
  requestLeaveSchema,
  type RequestLeaveInput
} from './utils/leave-schemas';

/** Resolves the person a request is *about*, which is not always the caller. */
async function loadSubject(employeeId: string) {
  const [row] = await db
    .select({
      id: employees.id,
      name: employeeDisplayName,
      managerId: employees.managerId,
      team: employees.team,
      status: employees.status
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!row || row.status === 'disabled') throw new HrError('That employee record is not available');
  return row;
}

/**
 * Who should be told about this request. The line manager if there is one, otherwise every
 * HR administrator — a request routed to nobody is the failure mode that makes people stop
 * trusting an approval queue.
 */
async function approverIdsFor(subjectManagerId: string | null): Promise<string[]> {
  if (subjectManagerId) return [subjectManagerId];
  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(isHrAdminRow, eq(employees.status, 'active')));
  return rows.map((row) => row.id);
}

export async function requestLeave(input: RequestLeaveInput) {
  const caller = await requireActiveEmployee();
  const parsed = requestLeaveSchema.parse(input);

  const subject = await loadSubject(parsed.employeeId ?? caller.id);
  if (!canRequestLeaveFor(caller, subject)) {
    throw new HrError('You cannot book leave for that person');
  }

  const [type] = await db
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.id, parsed.leaveTypeId))
    .limit(1);
  if (!type || type.archivedAt) throw new HrError('That leave type is not available');

  const holidays = await getPublicHolidayDates(parsed.startDate, parsed.endDate);
  const totalHalfDays = calculateLeaveHalfDays({
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    startUnit: parsed.startUnit,
    endUnit: parsed.endUnit,
    publicHolidays: holidays
  });

  if (totalHalfDays <= 0) {
    throw new HrError('Those dates contain no working days, so there is nothing to book');
  }

  // Balance is only a constraint for types that draw it down, and only when policy says a
  // negative balance is not allowed. Checked server-side on every submission rather than
  // trusted from the form, which can be replayed with any numbers.
  if (type.deductsFromAllowance) {
    const settings = await getLeaveSettings();
    if (!settings.allowNegativeBalance) {
      const balance = await getLeaveBalance(subject.id);
      if (totalHalfDays > balance.availableHalfDays) {
        throw new HrError(
          `That is ${formatHalfDays(totalHalfDays)}, but only ${formatHalfDays(
            Math.max(balance.availableHalfDays, 0)
          )} remain once leave already booked or awaiting approval is counted`
        );
      }
    }
  }

  // The same person booking two overlapping periods is a mistake rather than a policy
  // question: both would deduct from the allowance, so the year would be charged twice for
  // one day off. Inclusive overlap, the same condition as rangesOverlap in
  // lib/hr/leave-calculation.ts — existing.start <= new.end AND existing.end >= new.start.
  const [clash] = await db
    .select({
      id: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, subject.id),
        inArray(leaveRequests.status, ['approved', 'pending']),
        lte(leaveRequests.startDate, parsed.endDate),
        gte(leaveRequests.endDate, parsed.startDate)
      )
    )
    .limit(1);

  if (clash) {
    throw new HrError(
      `That overlaps leave already booked from ${clash.startDate} to ${clash.endDate}`
    );
  }

  const autoApproved = !type.requiresApproval;

  const [created] = await db
    .insert(leaveRequests)
    .values({
      employeeId: subject.id,
      leaveTypeId: type.id,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      startUnit: parsed.startUnit,
      endUnit: parsed.endUnit,
      totalHalfDays,
      reason: parsed.reason ?? null,
      status: autoApproved ? 'approved' : 'pending',
      autoApproved,
      decidedAt: autoApproved ? new Date() : null
    })
    .returning();

  if (autoApproved) {
    await writeCalendarEvent(created.id, subject, type.name, parsed.startDate, parsed.endDate);
  } else {
    for (const approverId of await approverIdsFor(subject.managerId)) {
      await createNotification({
        employeeId: approverId,
        type: 'leave_request_submitted',
        title: `${subject.name} requested ${formatHalfDays(totalHalfDays)} of ${type.name}`,
        body: `${parsed.startDate} to ${parsed.endDate}`,
        link: '/dashboard/hr/time-off'
      });
    }
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'leave_requested',
    resourceType: 'leave_request',
    resourceId: created.id,
    result: 'success',
    // Dates and duration only. The reason someone gives for wanting leave is theirs, and the
    // audit log is read by roles that have no business seeing it.
    metadata: {
      subjectEmployeeId: subject.id,
      leaveTypeId: type.id,
      totalHalfDays,
      autoApproved
    }
  });

  revalidatePath('/dashboard/hr/time-off');
  return { id: created.id, totalHalfDays, autoApproved };
}

/** Writes approved leave into the shared calendar so it shows on the Calendar tab. */
async function writeCalendarEvent(
  requestId: string,
  subject: { id: string; name: string; team: string | null },
  leaveTypeName: string,
  startDate: string,
  endDate: string
) {
  const [event] = await db
    .insert(calendarEvents)
    .values({
      title: `${subject.name} — ${leaveTypeName}`,
      // All-day, and the end is stored as the day after the last day of leave because an
      // all-day range is half-open: an event ending at 00:00 on the last day would render as
      // finishing the night before.
      startAt: new Date(`${startDate}T00:00:00.000Z`),
      endAt: new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + 86_400_000),
      allDay: true,
      team: subject.team ?? 'unassigned',
      createdByEmployeeId: subject.id,
      description: 'Approved leave. Managed from the HR module.'
    })
    .returning();

  await db
    .update(leaveRequests)
    .set({ calendarEventId: event.id, updatedAt: new Date() })
    .where(eq(leaveRequests.id, requestId));

  revalidatePath('/dashboard/calendar');
  return event.id;
}

export async function decideLeaveRequest(input: {
  requestId: string;
  decision: 'approved' | 'declined';
  note?: string;
}) {
  const caller = await requireActiveEmployee();
  const parsed = decideLeaveSchema.parse(input);

  const [request] = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, parsed.requestId))
    .limit(1);
  if (!request) throw new HrError('That request no longer exists');
  if (request.status !== 'pending') {
    throw new HrError(`That request has already been ${request.status}`);
  }

  const subject = await loadSubject(request.employeeId);
  if (!canDecideLeaveRequest(caller, subject)) {
    throw new HrError('You cannot decide that request');
  }

  await db
    .update(leaveRequests)
    .set({
      status: parsed.decision,
      decidedByEmployeeId: caller.id,
      decidedAt: new Date(),
      decisionNote: parsed.note ?? null,
      updatedAt: new Date()
    })
    .where(eq(leaveRequests.id, request.id));

  if (parsed.decision === 'approved') {
    const [type] = await db
      .select({ name: leaveTypes.name })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, request.leaveTypeId))
      .limit(1);
    await writeCalendarEvent(
      request.id,
      subject,
      type?.name ?? 'Leave',
      request.startDate,
      request.endDate
    );
  }

  await createNotification({
    employeeId: request.employeeId,
    type: `leave_request_${parsed.decision}`,
    title: `Your leave request was ${parsed.decision}`,
    body: `${request.startDate} to ${request.endDate}`,
    link: '/dashboard/hr/time-off'
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: `leave_request_${parsed.decision}`,
    resourceType: 'leave_request',
    resourceId: request.id,
    result: 'success',
    metadata: { subjectEmployeeId: request.employeeId, totalHalfDays: request.totalHalfDays }
  });

  revalidatePath('/dashboard/hr/time-off');
}

export async function cancelLeaveRequest(input: { requestId: string; reason?: string }) {
  const caller = await requireActiveEmployee();
  const parsed = cancelLeaveSchema.parse(input);

  const [request] = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, parsed.requestId))
    .limit(1);
  if (!request) throw new HrError('That request no longer exists');
  if (request.status === 'cancelled') return;
  if (request.status === 'declined') {
    throw new HrError('A declined request cannot be cancelled');
  }

  const subject = await loadSubject(request.employeeId);
  if (!canCancelLeaveRequest(caller, subject)) {
    throw new HrError('You cannot cancel that request');
  }

  await db
    .update(leaveRequests)
    .set({
      status: 'cancelled',
      decisionNote: parsed.reason ?? request.decisionNote,
      calendarEventId: null,
      updatedAt: new Date()
    })
    .where(eq(leaveRequests.id, request.id));

  // Remove the calendar entry too, otherwise cancelled leave keeps showing the person as away.
  if (request.calendarEventId) {
    await db.delete(calendarEvents).where(eq(calendarEvents.id, request.calendarEventId));
    revalidatePath('/dashboard/calendar');
  }

  // Tell the approver, not the requester — the requester is usually the one cancelling, and
  // notifying someone about their own action is noise.
  if (caller.id !== request.employeeId) {
    await createNotification({
      employeeId: request.employeeId,
      type: 'leave_request_cancelled',
      title: 'Your leave booking was cancelled',
      body: `${request.startDate} to ${request.endDate}`,
      link: '/dashboard/hr/time-off'
    });
  } else {
    for (const approverId of await approverIdsFor(subject.managerId)) {
      await createNotification({
        employeeId: approverId,
        type: 'leave_request_cancelled',
        title: `${subject.name} cancelled their leave`,
        body: `${request.startDate} to ${request.endDate}`,
        link: '/dashboard/hr/time-off'
      });
    }
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'leave_request_cancelled',
    resourceType: 'leave_request',
    resourceId: request.id,
    result: 'success',
    metadata: { subjectEmployeeId: request.employeeId }
  });

  revalidatePath('/dashboard/hr/time-off');
}

/**
 * Preview a request's cost and balance impact before it is submitted, so the form can show
 * "this is 4.5 days, leaving 7.5" rather than making someone submit to find out. Recomputed
 * server-side on submission — this is convenience, never the check.
 */
export async function previewLeaveRequest(input: {
  employeeId?: string;
  startDate: string;
  endDate: string;
  startUnit: 'full' | 'am' | 'pm';
  endUnit: 'full' | 'am' | 'pm';
}) {
  const caller = await requireActiveEmployee();
  const subject = await loadSubject(input.employeeId ?? caller.id);
  if (!canViewLeaveRequest(caller, subject)) {
    throw new HrError('You cannot see that person’s leave');
  }

  const holidays = await getPublicHolidayDates(input.startDate, input.endDate);
  const totalHalfDays = calculateLeaveHalfDays({ ...input, publicHolidays: holidays });
  const balance = await getLeaveBalance(subject.id);

  return {
    totalHalfDays,
    totalLabel: formatHalfDays(totalHalfDays),
    availableHalfDays: balance.availableHalfDays,
    afterHalfDays: balance.availableHalfDays - totalHalfDays,
    publicHolidaysInRange: holidays
  };
}
