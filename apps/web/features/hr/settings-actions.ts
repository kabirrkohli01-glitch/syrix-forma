'use server';

/**
 * The company-level HR configuration the rest of the module runs on: the leave year, the leave
 * types that exist, everyone's default entitlement, individual entitlements, and the public
 * holiday calendar.
 *
 * All of it was modelled in the schema and validated in `utils/leave-schemas.ts` and then never
 * given a write path, so `canManageHrSettings` had no caller and `leave_allowances` had no way
 * to be populated. That left every employee silently on the pro-rata default with no screen
 * saying so, and a company whose leave types had not been seeded unable to book leave at all.
 *
 * Everything here is HR-only, step-up authenticated and audited: these are not one person's
 * records, they are the figures every balance in the company is computed from.
 */

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, leaveAllowances, leaveSettings, leaveTypes, publicHolidays } from '@/lib/db/schema';
import { HALF_DAYS_PER_DAY } from '@/lib/hr/leave-calculation';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canManageHrSettings } from '@/lib/permissions/hr-access';
import { HrError, isUniqueViolation } from './utils/errors';
import { getLeaveSettings } from './utils/leave-queries';
import {
  addPublicHolidaySchema,
  isoDateSchema,
  updateLeaveSettingsSchema,
  upsertLeaveAllowanceSchema,
  upsertLeaveTypeSchema
} from './utils/leave-schemas';

/**
 * Days in, half days out.
 *
 * HR thinks in days and the database stores half days (see the storage note on `leave_requests`).
 * Doing the conversion in one function rather than at each call site is what stops a screen from
 * writing 25 into a column counted in halves and halving everybody's holiday.
 */
function toHalfDays(days: number): number {
  return Math.round(days * HALF_DAYS_PER_DAY);
}

/** Every screen in this module is gated the same way, so the gate is written once. */
async function requireHrSettingsAdmin() {
  const caller = await requireActiveEmployee();
  if (!canManageHrSettings(caller)) {
    throw new HrError(
      'Only an HR administrator can change company HR settings. An administrator grants this in Settings → People & Access.'
    );
  }
  return caller;
}

function revalidateHr() {
  revalidatePath('/dashboard/hr/settings');
  revalidatePath('/dashboard/hr/time-off');
  revalidatePath('/dashboard/hr');
}

// --- Leave policy ---

export async function updateLeaveSettings(input: z.input<typeof updateLeaveSettingsSchema>) {
  const caller = await requireHrSettingsAdmin();
  const parsed = updateLeaveSettingsSchema.parse(input);

  // 31 February is a valid pair of numbers and not a date. Rejected here rather than silently
  // rolling into March, because the leave year start is the anchor every balance is counted from
  // and a year that starts on a day that does not exist is not recoverable from later.
  const daysInMonth = new Date(Date.UTC(2024, parsed.leaveYearStartMonth, 0)).getUTCDate();
  if (parsed.leaveYearStartDay > daysInMonth) {
    throw new HrError('That month does not have that many days');
  }
  // 29 February would make the leave year start vanish in three years out of four.
  if (parsed.leaveYearStartMonth === 2 && parsed.leaveYearStartDay === 29) {
    throw new HrError('The leave year cannot start on 29 February — it does not occur every year');
  }

  const existing = await getLeaveSettings();

  await db
    .update(leaveSettings)
    .set({
      leaveYearStartMonth: parsed.leaveYearStartMonth,
      leaveYearStartDay: parsed.leaveYearStartDay,
      defaultEntitlementHalfDays: toHalfDays(parsed.defaultEntitlementDays),
      carryOverMaxHalfDays: toHalfDays(parsed.carryOverMaxDays),
      carryOverExpiryMonths: parsed.carryOverExpiryMonths,
      allowNegativeBalance: parsed.allowNegativeBalance,
      updatedAt: new Date()
    })
    .where(eq(leaveSettings.id, existing.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_leave_settings_updated',
    resourceType: 'leave_settings',
    resourceId: existing.id,
    result: 'success',
    metadata: {
      leaveYearStart: `${parsed.leaveYearStartDay}/${parsed.leaveYearStartMonth}`,
      defaultEntitlementDays: parsed.defaultEntitlementDays,
      allowNegativeBalance: parsed.allowNegativeBalance
    }
  });

  revalidateHr();
}

// --- Leave types ---

export async function upsertLeaveType(input: z.input<typeof upsertLeaveTypeSchema>) {
  const caller = await requireHrSettingsAdmin();
  const parsed = upsertLeaveTypeSchema.parse(input);

  if (parsed.id) {
    const [existing] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, parsed.id)).limit(1);
    if (!existing) throw new HrError('That leave type no longer exists');

    await db
      .update(leaveTypes)
      .set({
        name: parsed.name,
        deductsFromAllowance: parsed.deductsFromAllowance,
        isPaid: parsed.isPaid,
        requiresApproval: parsed.requiresApproval,
        colour: parsed.colour ?? null
      })
      .where(eq(leaveTypes.id, parsed.id));

    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'hr_leave_type_updated',
      resourceType: 'leave_type',
      resourceId: parsed.id,
      result: 'success',
      metadata: { name: parsed.name, deductsFromAllowance: parsed.deductsFromAllowance }
    });

    revalidateHr();
    return { id: parsed.id };
  }

  // Position keeps the booking dropdown in a deliberate order rather than alphabetical, so
  // "Holiday" stays at the top where it belongs. A new type goes to the end.
  const [{ nextPosition }] = await db
    .select({ nextPosition: sql<number>`coalesce(max(${leaveTypes.position}), -1) + 1` })
    .from(leaveTypes);

  let created;
  try {
    [created] = await db
      .insert(leaveTypes)
      .values({
        name: parsed.name,
        deductsFromAllowance: parsed.deductsFromAllowance,
        isPaid: parsed.isPaid,
        requiresApproval: parsed.requiresApproval,
        colour: parsed.colour ?? null,
        position: nextPosition
      })
      .returning({ id: leaveTypes.id });
  } catch (error) {
    // The name is unique at database level. Catching the violation here turns it into a sentence
    // rather than the generic internal-fault message, and leaves the constraint — not a
    // read-then-write check with a race in the middle — as the thing that actually enforces it.
    if (isUniqueViolation(error, 'leave_types_name_unique')) {
      throw new HrError(`There is already a leave type called "${parsed.name}"`);
    }
    throw error;
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_leave_type_created',
    resourceType: 'leave_type',
    resourceId: created.id,
    result: 'success',
    metadata: { name: parsed.name }
  });

  revalidateHr();
  return { id: created.id };
}

/**
 * Archive rather than delete.
 *
 * Leave already booked against a type references it, and `leave_requests.leaveTypeId` is
 * `onDelete: 'restrict'` — deleting would either fail or, with a looser constraint, orphan
 * historical bookings. Archiving takes it out of the booking dropdown while leaving every past
 * request readable and correctly labelled.
 */
export async function setLeaveTypeArchived(leaveTypeId: string, archived: boolean) {
  const caller = await requireHrSettingsAdmin();
  z.uuid().parse(leaveTypeId);

  const [existing] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, leaveTypeId)).limit(1);
  if (!existing) throw new HrError('That leave type no longer exists');

  if (archived) {
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(leaveTypes)
      .where(sql`${leaveTypes.archivedAt} is null and ${leaveTypes.id} <> ${leaveTypeId}`);
    if (remaining === 0) {
      throw new HrError(
        'That is the only leave type still in use — archiving it would leave nothing anyone could book. Add another first.'
      );
    }
  }

  await db
    .update(leaveTypes)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(leaveTypes.id, leaveTypeId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: archived ? 'hr_leave_type_archived' : 'hr_leave_type_restored',
    resourceType: 'leave_type',
    resourceId: leaveTypeId,
    result: 'success',
    metadata: { name: existing.name }
  });

  revalidateHr();
}

// --- Individual allowances ---

export async function upsertLeaveAllowance(input: z.input<typeof upsertLeaveAllowanceSchema>) {
  const caller = await requireHrSettingsAdmin();
  const parsed = upsertLeaveAllowanceSchema.parse(input);

  const [subject] = await db
    .select({ id: employees.id, status: employees.status })
    .from(employees)
    .where(eq(employees.id, parsed.employeeId))
    .limit(1);
  if (!subject) throw new HrError('That employee record no longer exists');

  const values = {
    employeeId: parsed.employeeId,
    leaveYearStart: parsed.leaveYearStart,
    entitlementHalfDays: toHalfDays(parsed.entitlementDays),
    carriedOverHalfDays: toHalfDays(parsed.carriedOverDays),
    adjustmentHalfDays: toHalfDays(parsed.adjustmentDays),
    adjustmentNote: parsed.adjustmentNote?.trim() || null,
    updatedAt: new Date()
  };

  // One row per person per leave year is a database constraint, so setting an allowance twice
  // has to update rather than insert a second one. Done as an upsert instead of read-then-write
  // so two administrators editing at once cannot both see "no row" and both insert.
  await db
    .insert(leaveAllowances)
    .values(values)
    .onConflictDoUpdate({
      target: [leaveAllowances.employeeId, leaveAllowances.leaveYearStart],
      set: {
        entitlementHalfDays: values.entitlementHalfDays,
        carriedOverHalfDays: values.carriedOverHalfDays,
        adjustmentHalfDays: values.adjustmentHalfDays,
        adjustmentNote: values.adjustmentNote,
        updatedAt: values.updatedAt
      }
    });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_leave_allowance_set',
    resourceType: 'employee',
    resourceId: parsed.employeeId,
    result: 'success',
    metadata: {
      leaveYearStart: parsed.leaveYearStart,
      entitlementDays: parsed.entitlementDays,
      carriedOverDays: parsed.carriedOverDays,
      adjustmentDays: parsed.adjustmentDays
    }
  });

  revalidateHr();
}

/**
 * Remove an individual allowance so the person falls back to the company default.
 *
 * Deliberately not the same as setting it to zero: zero means "this person gets no holiday",
 * which is a decision, and no row means "nobody has decided, use the default", which is not.
 * Conflating the two is how someone ends up with an entitlement of nothing by accident.
 */
export async function clearLeaveAllowance(employeeId: string, leaveYearStart: string) {
  const caller = await requireHrSettingsAdmin();
  z.uuid().parse(employeeId);
  isoDateSchema.parse(leaveYearStart);

  await db
    .delete(leaveAllowances)
    .where(
      and(
        eq(leaveAllowances.employeeId, employeeId),
        eq(leaveAllowances.leaveYearStart, leaveYearStart)
      )
    );

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_leave_allowance_cleared',
    resourceType: 'employee',
    resourceId: employeeId,
    result: 'success',
    metadata: { leaveYearStart }
  });

  revalidateHr();
}

// --- Public holidays ---

export async function addPublicHoliday(input: z.input<typeof addPublicHolidaySchema>) {
  const caller = await requireHrSettingsAdmin();
  const parsed = addPublicHolidaySchema.parse(input);

  try {
    await db.insert(publicHolidays).values({
      date: parsed.date,
      name: parsed.name,
      region: parsed.region
    });
  } catch (error) {
    if (isUniqueViolation(error, 'public_holidays_date_region_unique')) {
      throw new HrError(`${parsed.date} is already recorded as a public holiday for ${parsed.region}`);
    }
    throw error;
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_public_holiday_added',
    resourceType: 'public_holiday',
    resourceId: parsed.date,
    result: 'success',
    metadata: { name: parsed.name, region: parsed.region }
  });

  revalidateHr();
}

/**
 * Removing a public holiday does not recalculate leave already booked around it.
 *
 * That is deliberate: a booking's length was agreed and approved at the time, and silently
 * lengthening somebody's holiday months later because the calendar was corrected would change a
 * decision nobody revisited. New bookings use the corrected calendar.
 */
export async function removePublicHoliday(publicHolidayId: string) {
  const caller = await requireHrSettingsAdmin();
  z.uuid().parse(publicHolidayId);

  const [removed] = await db
    .delete(publicHolidays)
    .where(eq(publicHolidays.id, publicHolidayId))
    .returning({ date: publicHolidays.date, name: publicHolidays.name });
  if (!removed) throw new HrError('That public holiday no longer exists');

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_public_holiday_removed',
    resourceType: 'public_holiday',
    resourceId: publicHolidayId,
    result: 'success',
    metadata: { name: removed.name, date: removed.date }
  });

  revalidateHr();
}
