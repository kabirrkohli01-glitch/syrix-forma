import { and, desc, eq, gte, isNull, lte, ne, or, sum } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import {
  clockEvents,
  employees,
  expenseCategories,
  expenseClaims,
  expenseItems,
  mileageRates,
  shifts,
  shiftSwapRequests,
  timesheetEntries,
  timesheets
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { rateInForceOn, type MileageBand } from '@/lib/hr/money';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { canViewExpenseClaim, hrScopeFor, isLineManagerOf } from '@/lib/permissions/hr-access';

function subjectVisibility(caller: ActiveEmployee, employeeIdColumn: AnyPgColumn) {
  if (hrScopeFor(caller) === 'all') return undefined;
  return or(eq(employeeIdColumn, caller.id), eq(employees.managerId, caller.id));
}

// --- Rota ---

export type ShiftRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  onDate: string;
  startMinute: number;
  endMinute: number;
  unpaidBreakMinutes: number;
  templateName: string | null;
  publishedAt: Date | null;
  swapStatus: string | null;
};

export async function listShifts(
  caller: ActiveEmployee,
  from: string,
  to: string
): Promise<ShiftRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select({
      id: shifts.id,
      employeeId: shifts.employeeId,
      employeeName: employeeDisplayName,
      onDate: shifts.onDate,
      startMinute: shifts.startMinute,
      endMinute: shifts.endMinute,
      unpaidBreakMinutes: shifts.unpaidBreakMinutes,
      templateName: shifts.templateName,
      publishedAt: shifts.publishedAt,
      swapStatus: shiftSwapRequests.status
    })
    .from(shifts)
    .innerJoin(employees, eq(employees.id, shifts.employeeId))
    .leftJoin(
      shiftSwapRequests,
      and(
        eq(shiftSwapRequests.shiftId, shifts.id),
        ne(shiftSwapRequests.status, 'cancelled'),
        ne(shiftSwapRequests.status, 'declined')
      )
    )
    .where(
      and(
        gte(shifts.onDate, from),
        lte(shifts.onDate, to),
        subjectVisibility(caller, shifts.employeeId)
      )
    )
    .orderBy(shifts.onDate, shifts.startMinute);
}

export async function listShiftTemplates() {
  const { shiftTemplates } = await import('@/lib/db/schema');
  return db.select().from(shiftTemplates).orderBy(shiftTemplates.startMinute);
}

/** Swap requests the caller could act on: offered to them, or awaiting their approval. */
export async function listShiftSwaps(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select({
      id: shiftSwapRequests.id,
      shiftId: shiftSwapRequests.shiftId,
      status: shiftSwapRequests.status,
      requestedByEmployeeId: shiftSwapRequests.requestedByEmployeeId,
      requestedByName: employeeDisplayName,
      acceptedByEmployeeId: shiftSwapRequests.acceptedByEmployeeId,
      offeredToEmployeeId: shiftSwapRequests.offeredToEmployeeId,
      note: shiftSwapRequests.note,
      onDate: shifts.onDate,
      startMinute: shifts.startMinute,
      endMinute: shifts.endMinute
    })
    .from(shiftSwapRequests)
    .innerJoin(shifts, eq(shifts.id, shiftSwapRequests.shiftId))
    .innerJoin(employees, eq(employees.id, shiftSwapRequests.requestedByEmployeeId))
    .where(ne(shiftSwapRequests.status, 'cancelled'))
    .orderBy(shifts.onDate);
}

// --- Timesheets ---

/** Monday of the week containing `onDate`, as an ISO date. */
export function weekStartFor(onDate: string): string {
  const [year, month, day] = onDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay: 0 is Sunday, so Sunday needs to go back six days rather than forward one.
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

export type TimesheetRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  weekStart: string;
  status: (typeof timesheets.status.enumValues)[number];
  totalMinutes: number;
};

export async function listTimesheets(caller: ActiveEmployee): Promise<TimesheetRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const rows = await db
    .select({
      id: timesheets.id,
      employeeId: timesheets.employeeId,
      employeeName: employeeDisplayName,
      weekStart: timesheets.weekStart,
      status: timesheets.status,
      totalMinutes: sum(timesheetEntries.minutes)
    })
    .from(timesheets)
    .innerJoin(employees, eq(employees.id, timesheets.employeeId))
    .leftJoin(timesheetEntries, eq(timesheetEntries.timesheetId, timesheets.id))
    .where(subjectVisibility(caller, timesheets.employeeId))
    .groupBy(timesheets.id, employeeDisplayName)
    .orderBy(desc(timesheets.weekStart));

  // `sum` comes back as a string from the driver, and null when a sheet has no entries yet.
  return rows.map((row) => ({ ...row, totalMinutes: Number(row.totalMinutes ?? 0) }));
}

export async function getTimesheetEntries(timesheetId: string) {
  return db
    .select()
    .from(timesheetEntries)
    .where(eq(timesheetEntries.timesheetId, timesheetId))
    .orderBy(timesheetEntries.onDate);
}

/** Clock events for one person on one day, oldest first, so they can be paired on read. */
export async function listClockEventsForDay(employeeId: string, onDate: string) {
  const dayStart = new Date(`${onDate}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  return db
    .select()
    .from(clockEvents)
    .where(
      and(
        eq(clockEvents.employeeId, employeeId),
        gte(clockEvents.occurredAt, dayStart),
        lte(clockEvents.occurredAt, dayEnd)
      )
    )
    .orderBy(clockEvents.occurredAt);
}

/**
 * Whether this person is currently clocked in, derived from their last event rather than
 * stored. A stored flag and an event log can disagree; the log is the record.
 */
export async function isClockedIn(employeeId: string): Promise<boolean> {
  const [latest] = await db
    .select({ eventType: clockEvents.eventType })
    .from(clockEvents)
    .where(eq(clockEvents.employeeId, employeeId))
    .orderBy(desc(clockEvents.occurredAt))
    .limit(1);

  return latest?.eventType === 'in' || latest?.eventType === 'break_end';
}

// --- Expenses ---

export async function listExpenseCategories() {
  return db
    .select()
    .from(expenseCategories)
    .where(isNull(expenseCategories.archivedAt))
    .orderBy(expenseCategories.name);
}

/** Mileage bands in force on a date, as the pure calculator expects them. */
export async function getMileageBands(onDate: string, vehicleType = 'car'): Promise<MileageBand[]> {
  const rows = await db
    .select()
    .from(mileageRates)
    .where(eq(mileageRates.vehicleType, vehicleType));

  // Several generations of rates can coexist; for each distance band take the one that was in
  // force on the journey date, so a historic claim reconciles against the historic rate.
  const byBand = new Map<number, typeof rows>();
  for (const row of rows) {
    byBand.set(row.fromMiles, [...(byBand.get(row.fromMiles) ?? []), row]);
  }

  return [...byBand.entries()]
    .map(([fromMiles, candidates]) => {
      const inForce = rateInForceOn(candidates, onDate);
      return inForce ? { fromMiles, pencePerMile: inForce.pencePerMile } : null;
    })
    .filter((band): band is MileageBand => band !== null)
    .toSorted((a, b) => a.fromMiles - b.fromMiles);
}

/**
 * Miles already claimed by this employee in the UK tax year containing `onDate`.
 *
 * The UK tax year runs 6 April to 5 April, which is what decides when the mileage bands
 * reset — not the calendar year and not the company's own leave year.
 */
export async function milesClaimedInTaxYear(employeeId: string, onDate: string): Promise<number> {
  const [year, month, day] = onDate.split('-').map(Number);
  const taxYearStartYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1;
  const from = `${taxYearStartYear}-04-06`;
  const to = `${taxYearStartYear + 1}-04-05`;

  const rows = await db
    .select({ miles: expenseItems.miles })
    .from(expenseItems)
    .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
    .where(
      and(
        eq(expenseClaims.employeeId, employeeId),
        // Draft claims are excluded: an unsubmitted claim has not been claimed yet, and
        // counting it would quietly push a real journey into the lower rate band.
        ne(expenseClaims.status, 'draft'),
        ne(expenseClaims.status, 'rejected'),
        gte(expenseItems.spentOn, from),
        lte(expenseItems.spentOn, to)
      )
    );

  return rows.reduce((total, row) => total + (row.miles ?? 0), 0);
}

export type ExpenseClaimRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  title: string;
  status: (typeof expenseClaims.status.enumValues)[number];
  totalPence: number;
  currency: string;
  submittedAt: Date | null;
  paidAt: Date | null;
};

export async function listExpenseClaims(caller: ActiveEmployee): Promise<ExpenseClaimRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  // A finance user sees company-wide spend, the same widening their pay access gets.
  const visibility = caller.financeAccess
    ? undefined
    : subjectVisibility(caller, expenseClaims.employeeId);

  return db
    .select({
      id: expenseClaims.id,
      employeeId: expenseClaims.employeeId,
      employeeName: employeeDisplayName,
      title: expenseClaims.title,
      status: expenseClaims.status,
      totalPence: expenseClaims.totalPence,
      currency: expenseClaims.currency,
      submittedAt: expenseClaims.submittedAt,
      paidAt: expenseClaims.paidAt
    })
    .from(expenseClaims)
    .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
    .where(visibility)
    .orderBy(desc(expenseClaims.createdAt));
}

// Not yet called from anywhere — the line-item detail view this backs hasn't been built. Takes
// the caller and re-runs the same check as the claim list (canViewExpenseClaim) rather than
// trusting that whatever eventually calls this already checked, since a claimId is exactly the
// kind of caller-supplied id an IDOR walks in through.
export async function getExpenseItems(caller: ActiveEmployee, claimId: string) {
  const [claim] = await db
    .select({ id: expenseClaims.id, employeeId: expenseClaims.employeeId, managerId: employees.managerId })
    .from(expenseClaims)
    .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
    .where(eq(expenseClaims.id, claimId))
    .limit(1);
  if (!claim) return [];
  if (!canViewExpenseClaim(caller, { id: claim.employeeId, managerId: claim.managerId })) return [];

  return db
    .select({
      id: expenseItems.id,
      description: expenseItems.description,
      spentOn: expenseItems.spentOn,
      amountPence: expenseItems.amountPence,
      miles: expenseItems.miles,
      pencePerMileUsed: expenseItems.pencePerMileUsed,
      categoryName: expenseCategories.name,
      hasReceipt: expenseItems.receiptStorageKey
    })
    .from(expenseItems)
    .leftJoin(expenseCategories, eq(expenseCategories.id, expenseItems.categoryId))
    .where(eq(expenseItems.claimId, claimId))
    .orderBy(expenseItems.spentOn);
}

/** Everyone the caller can roster, approve for, or see spend for. */
export async function listWorkSubjects(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  const visibility =
    hrScopeFor(caller) === 'all' || caller.financeAccess
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
