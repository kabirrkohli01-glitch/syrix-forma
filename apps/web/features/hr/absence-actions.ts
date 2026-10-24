'use server';

import { and, eq, gte, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { employees, returnToWorkInterviews, sicknessRecords } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { countWorkingDays, HALF_DAYS_PER_DAY } from '@/lib/hr/leave-calculation';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canRecordAbsence,
  canRecordReturnToWork,
  canViewAbsenceRecord
} from '@/lib/permissions/hr-access';
import { HrError } from './utils/errors';
import { getPublicHolidayDates } from './utils/leave-queries';
import {
  closeSicknessSchema,
  recordReturnToWorkSchema,
  recordSicknessSchema,
  type RecordSicknessInput
} from './utils/leave-schemas';

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

/** Working days lost across an absence, in half days. */
async function absenceHalfDays(startDate: string, endDate: string): Promise<number> {
  const holidays = await getPublicHolidayDates(startDate, endDate);
  return countWorkingDays(startDate, endDate, holidays) * HALF_DAYS_PER_DAY;
}

export async function recordSickness(input: RecordSicknessInput) {
  const caller = await requireActiveEmployee();
  const parsed = recordSicknessSchema.parse(input);

  const subject = await loadSubject(parsed.employeeId ?? caller.id);
  if (!canRecordAbsence(caller, subject)) {
    throw new HrError('You cannot record absence for that person');
  }

  // An open absence is one with no end date yet. A second open record for the same person
  // would make "are they off right now" unanswerable and would count as two occurrences in
  // the Bradford score for what is really one continuing absence.
  const [alreadyOpen] = await db
    .select({ id: sicknessRecords.id, startDate: sicknessRecords.startDate })
    .from(sicknessRecords)
    .where(and(eq(sicknessRecords.employeeId, subject.id), isNull(sicknessRecords.endDate)))
    .limit(1);

  if (alreadyOpen) {
    throw new HrError(
      `An absence starting ${alreadyOpen.startDate} is still open. Record a return date on that one first.`
    );
  }

  const totalHalfDays = parsed.endDate
    ? await absenceHalfDays(parsed.startDate, parsed.endDate)
    : null;

  const [created] = await db
    .insert(sicknessRecords)
    .values({
      employeeId: subject.id,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? null,
      totalHalfDays,
      category: parsed.category ?? null,
      notes: parsed.notes ?? null,
      isSelfCertified: parsed.isSelfCertified,
      recordedByEmployeeId: caller.id
    })
    .returning();

  // Tell the line manager when someone else recorded it, so an absence logged by HR or by the
  // employee themselves does not go unnoticed by the person managing the work.
  if (subject.managerId && subject.managerId !== caller.id) {
    await createNotification({
      employeeId: subject.managerId,
      type: 'absence_recorded',
      title: `${subject.name} is recorded as absent`,
      body: parsed.endDate
        ? `${parsed.startDate} to ${parsed.endDate}`
        : `From ${parsed.startDate}, still open`,
      link: '/dashboard/hr/absence'
    });
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'sickness_recorded',
    resourceType: 'sickness_record',
    resourceId: created.id,
    result: 'success',
    // Dates only. The category and notes are health data — recording them in the audit log,
    // which SECURITY_ADMIN can read, would route special category data to a role that
    // docs/permissions-matrix.md deliberately walls off from it.
    metadata: {
      subjectEmployeeId: subject.id,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? null
    }
  });

  revalidatePath('/dashboard/hr/absence');
  return { id: created.id };
}

export async function closeSickness(input: { sicknessRecordId: string; endDate: string }) {
  const caller = await requireActiveEmployee();
  const parsed = closeSicknessSchema.parse(input);

  const [record] = await db
    .select()
    .from(sicknessRecords)
    .where(eq(sicknessRecords.id, parsed.sicknessRecordId))
    .limit(1);
  if (!record) throw new HrError('That absence record no longer exists');

  const subject = await loadSubject(record.employeeId);
  if (!canRecordAbsence(caller, subject)) {
    throw new HrError('You cannot change that absence record');
  }
  if (parsed.endDate < record.startDate) {
    throw new HrError('The return date cannot be before the first day of absence');
  }

  await db
    .update(sicknessRecords)
    .set({
      endDate: parsed.endDate,
      totalHalfDays: await absenceHalfDays(record.startDate, parsed.endDate),
      updatedAt: new Date()
    })
    .where(eq(sicknessRecords.id, record.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'sickness_closed',
    resourceType: 'sickness_record',
    resourceId: record.id,
    result: 'success',
    metadata: { subjectEmployeeId: record.employeeId, endDate: parsed.endDate }
  });

  revalidatePath('/dashboard/hr/absence');
}

export async function recordReturnToWork(input: {
  sicknessRecordId: string;
  conductedOn: string;
  notes?: string;
  adjustmentsAgreed?: string;
}) {
  const caller = await requireActiveEmployee();
  const parsed = recordReturnToWorkSchema.parse(input);

  const [record] = await db
    .select()
    .from(sicknessRecords)
    .where(eq(sicknessRecords.id, parsed.sicknessRecordId))
    .limit(1);
  if (!record) throw new HrError('That absence record no longer exists');

  const subject = await loadSubject(record.employeeId);
  if (!canRecordReturnToWork(caller, subject)) {
    throw new HrError('You cannot record a return-to-work interview for that person');
  }

  await db
    .insert(returnToWorkInterviews)
    .values({
      sicknessRecordId: record.id,
      conductedByEmployeeId: caller.id,
      conductedOn: parsed.conductedOn,
      notes: parsed.notes ?? null,
      adjustmentsAgreed: parsed.adjustmentsAgreed ?? null
    })
    // One interview per absence; re-recording updates rather than creating a second.
    .onConflictDoUpdate({
      target: returnToWorkInterviews.sicknessRecordId,
      set: {
        conductedByEmployeeId: caller.id,
        conductedOn: parsed.conductedOn,
        notes: parsed.notes ?? null,
        adjustmentsAgreed: parsed.adjustmentsAgreed ?? null
      }
    });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'return_to_work_recorded',
    resourceType: 'sickness_record',
    resourceId: record.id,
    result: 'success',
    metadata: { subjectEmployeeId: record.employeeId }
  });

  revalidatePath('/dashboard/hr/absence');
}

/**
 * Absences overlapping a window, for the caller's own record. Kept as an action rather than a
 * query import so a client component can refresh it without a full page navigation.
 */
export async function listMyRecentAbsence(sinceDate: string) {
  const caller = await requireActiveEmployee();
  if (!canViewAbsenceRecord(caller, { id: caller.id, managerId: caller.managerId })) return [];

  return db
    .select({
      id: sicknessRecords.id,
      startDate: sicknessRecords.startDate,
      endDate: sicknessRecords.endDate,
      totalHalfDays: sicknessRecords.totalHalfDays
    })
    .from(sicknessRecords)
    .where(
      and(eq(sicknessRecords.employeeId, caller.id), gte(sicknessRecords.startDate, sinceDate))
    )
    .orderBy(sicknessRecords.startDate);
}
