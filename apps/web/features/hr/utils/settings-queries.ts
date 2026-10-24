import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employeeDisplayName } from '@/lib/db/display-name';
import { employeeProfiles, employees, leaveAllowances, leaveTypes, publicHolidays } from '@/lib/db/schema';
import { HALF_DAYS_PER_DAY, proRataEntitlement } from '@/lib/hr/leave-calculation';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { canManageHrSettings } from '@/lib/permissions/hr-access';
import { getLeaveSettings, type LeaveYear } from './leave-queries';

/** Half days out, days in — the inverse of the conversion in settings-actions.ts. */
export function toDays(halfDays: number): number {
  return halfDays / HALF_DAYS_PER_DAY;
}

/** Every leave type including archived ones, which the settings screen has to show to restore. */
export async function listAllLeaveTypes(caller: ActiveEmployee) {
  if (!canManageHrSettings(caller)) return [];
  return db.select().from(leaveTypes).orderBy(asc(leaveTypes.position), asc(leaveTypes.name));
}

export type AllowanceRow = {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  team: string | null;
  /** Days, not half days — what the screen shows and what HR types. */
  entitlementDays: number;
  carriedOverDays: number;
  adjustmentDays: number;
  adjustmentNote: string | null;
  /**
   * False means no allowance row exists and the figure shown is the company default pro-rated by
   * the contracted week. The distinction matters: it is the difference between a number somebody
   * decided and a number nobody has looked at yet.
   */
  isExplicit: boolean;
};

/**
 * Everyone's entitlement for one leave year, in one query per table rather than one per person.
 *
 * The obvious implementation calls getLeaveBalance() in a loop, which is three queries each and
 * turns a thirty-person company into ninety round trips on a page that only needs entitlement,
 * not balance. Joined instead, with the default applied in JS where the pro-rata rule already
 * lives.
 */
export async function listLeaveAllowances(
  caller: ActiveEmployee,
  year: LeaveYear
): Promise<AllowanceRow[]> {
  if (!canManageHrSettings(caller)) return [];

  const settings = await getLeaveSettings();

  const rows = await db
    .select({
      employeeId: employees.id,
      name: employeeDisplayName,
      jobTitle: employeeProfiles.jobTitle,
      team: employees.team,
      workingDaysPerWeek: employeeProfiles.workingDaysPerWeek,
      entitlementHalfDays: leaveAllowances.entitlementHalfDays,
      carriedOverHalfDays: leaveAllowances.carriedOverHalfDays,
      adjustmentHalfDays: leaveAllowances.adjustmentHalfDays,
      adjustmentNote: leaveAllowances.adjustmentNote
    })
    .from(employees)
    .leftJoin(employeeProfiles, eq(employeeProfiles.employeeId, employees.id))
    .leftJoin(
      leaveAllowances,
      and(
        eq(leaveAllowances.employeeId, employees.id),
        eq(leaveAllowances.leaveYearStart, year.start)
      )
    )
    .where(eq(employees.status, 'active'))
    .orderBy(asc(employeeDisplayName));

  return rows.map((row) => {
    const isExplicit = row.entitlementHalfDays !== null;
    const entitlementHalfDays = isExplicit
      ? row.entitlementHalfDays!
      : proRataEntitlement({
          fullTimeEntitlementHalfDays: settings.defaultEntitlementHalfDays,
          workingDaysPerWeek: row.workingDaysPerWeek ?? null
        });

    return {
      employeeId: row.employeeId,
      name: row.name,
      jobTitle: row.jobTitle,
      team: row.team,
      entitlementDays: toDays(entitlementHalfDays),
      carriedOverDays: toDays(row.carriedOverHalfDays ?? 0),
      adjustmentDays: toDays(row.adjustmentHalfDays ?? 0),
      adjustmentNote: row.adjustmentNote,
      isExplicit
    };
  });
}

/** Public holidays inside the leave year, which is the window that affects current bookings. */
export async function listPublicHolidays(caller: ActiveEmployee, year: LeaveYear) {
  if (!canManageHrSettings(caller)) return [];
  return db
    .select()
    .from(publicHolidays)
    .where(and(gte(publicHolidays.date, year.start), lte(publicHolidays.date, year.end)))
    .orderBy(asc(publicHolidays.date));
}
