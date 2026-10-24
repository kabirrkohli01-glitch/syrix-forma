/**
 * Leave arithmetic. Pure functions over plain ISO date strings — no database, no clock, no
 * timezone. Every duration here is an integer count of half days, matching the storage
 * convention documented on `leave_requests` in lib/db/schema.ts.
 *
 * Dates are handled as `YYYY-MM-DD` strings and converted with `Date.UTC`, never with
 * `new Date('2026-04-01')` local-time parsing. A leave day is a calendar day, not an instant:
 * parsing it in local time puts anyone west of UTC on the previous day, which silently shifts
 * every booking by one day for part of the world and is exactly the bug that makes leave
 * systems untrustworthy.
 */

export const HALF_DAYS_PER_DAY = 2;

export type LeaveUnit = 'full' | 'am' | 'pm';

/** Days of the week that are working days, as JavaScript day numbers (0 = Sunday). */
const DEFAULT_WORKING_WEEKDAYS = new Set([1, 2, 3, 4, 5]);

function toUtcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Not an ISO date: ${iso}`);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every calendar date from `start` to `end` inclusive. */
export function datesInRange(start: string, end: string): string[] {
  const from = toUtcDate(start);
  const to = toUtcDate(end);
  if (to < from) return [];

  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) {
    out.push(toIso(d));
  }
  return out;
}

export function isWeekend(iso: string): boolean {
  return !DEFAULT_WORKING_WEEKDAYS.has(toUtcDate(iso).getUTCDay());
}

/**
 * Working days in a range, excluding weekends and any date in `publicHolidays`.
 *
 * v1 limitation, stated rather than hidden: "working day" means Monday to Friday for everyone.
 * A part-timer's contracted days are used to pro-rata their *entitlement*
 * (`proRataEntitlement`), not to decide which individual days count as working days — so a
 * Tuesday/Thursday employee booking a full week is currently charged five days rather than
 * two. Fixing that properly needs a per-employee working-day pattern on the profile, which is
 * a schema change rather than a tweak here. Until then, HR corrects such cases with the
 * allowance adjustment field.
 */
export function countWorkingDays(
  start: string,
  end: string,
  publicHolidays: readonly string[]
): number {
  const holidays = new Set(publicHolidays);
  return datesInRange(start, end).filter((iso) => !isWeekend(iso) && !holidays.has(iso)).length;
}

export type LeaveDurationInput = {
  startDate: string;
  endDate: string;
  startUnit: LeaveUnit;
  endUnit: LeaveUnit;
  publicHolidays: readonly string[];
};

/**
 * How many half days a request costs.
 *
 * A half-day unit only subtracts anything when the day it applies to is itself a working day —
 * booking a half day on a bank holiday costs nothing, and must not produce a negative or
 * fractional result.
 */
export function calculateLeaveHalfDays(input: LeaveDurationInput): number {
  const { startDate, endDate, startUnit, endUnit, publicHolidays } = input;
  const holidays = new Set(publicHolidays);

  const workingDays = countWorkingDays(startDate, endDate, publicHolidays);
  if (workingDays === 0) return 0;

  const isWorkingDay = (iso: string) => !isWeekend(iso) && !holidays.has(iso);
  let halfDays = workingDays * HALF_DAYS_PER_DAY;

  // A single-day request is the one case where both units describe the same day, so applying
  // both would deduct the whole day twice over.
  if (startDate === endDate) {
    if (startUnit !== 'full' && isWorkingDay(startDate)) halfDays -= 1;
    return halfDays;
  }

  if (startUnit !== 'full' && isWorkingDay(startDate)) halfDays -= 1;
  if (endUnit !== 'full' && isWorkingDay(endDate)) halfDays -= 1;

  return halfDays;
}

/** Display helper. Nothing outside this module should divide by two itself. */
export function formatHalfDays(halfDays: number): string {
  const days = halfDays / HALF_DAYS_PER_DAY;
  const rounded = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${rounded} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
}

export type LeaveBalanceInput = {
  entitlementHalfDays: number;
  carriedOverHalfDays: number;
  adjustmentHalfDays: number;
  /** Half days already approved in this leave year. */
  takenHalfDays: number;
  /** Half days requested but not yet decided. */
  pendingHalfDays: number;
};

export type LeaveBalance = {
  totalHalfDays: number;
  takenHalfDays: number;
  pendingHalfDays: number;
  /** What is left once approved leave is deducted — what the employee has actually used. */
  remainingHalfDays: number;
  /**
   * Remaining once pending requests are also deducted. This is the figure a new request is
   * checked against: allowing someone to book against leave they have already requested but
   * not yet had approved is how balances go negative without anyone noticing.
   */
  availableHalfDays: number;
};

export function calculateBalance(input: LeaveBalanceInput): LeaveBalance {
  const totalHalfDays =
    input.entitlementHalfDays + input.carriedOverHalfDays + input.adjustmentHalfDays;
  return {
    totalHalfDays,
    takenHalfDays: input.takenHalfDays,
    pendingHalfDays: input.pendingHalfDays,
    remainingHalfDays: totalHalfDays - input.takenHalfDays,
    availableHalfDays: totalHalfDays - input.takenHalfDays - input.pendingHalfDays
  };
}

/**
 * The leave year containing `onDate`, given the policy's start month and day.
 *
 * Returns the first day of that year. A leave year starting 1 April means 2026-03-31 belongs
 * to the year beginning 2025-04-01, which is the off-by-one every homegrown implementation
 * gets wrong at least once.
 */
export function leaveYearStartFor(onDate: string, startMonth: number, startDay: number): string {
  const date = toUtcDate(onDate);
  const year = date.getUTCFullYear();
  const thisYearsStart = new Date(Date.UTC(year, startMonth - 1, startDay));
  const start =
    date < thisYearsStart ? new Date(Date.UTC(year - 1, startMonth - 1, startDay)) : thisYearsStart;
  return toIso(start);
}

/** The last day of the leave year beginning on `leaveYearStart`. */
export function leaveYearEndFor(leaveYearStart: string): string {
  const start = toUtcDate(leaveYearStart);
  const end = new Date(
    Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate())
  );
  return toIso(new Date(end.getTime() - 86_400_000));
}

/**
 * Pro-rata entitlement for someone who does not work a full week, or who joins or leaves part
 * way through the leave year.
 *
 * Rounded up to the nearest half day. Rounding a statutory entitlement down shortchanges the
 * employee, and the amounts involved are small enough that rounding in their favour is both
 * the safer legal position and not worth arguing about.
 */
export function proRataEntitlement(input: {
  fullTimeEntitlementHalfDays: number;
  workingDaysPerWeek?: number | null;
  /** Proportion of the leave year the person is employed for, 0 to 1. */
  proportionOfYear?: number;
}): number {
  const weekFraction =
    input.workingDaysPerWeek && input.workingDaysPerWeek > 0
      ? Math.min(input.workingDaysPerWeek, 5) / 5
      : 1;
  const yearFraction = input.proportionOfYear ?? 1;
  return Math.ceil(input.fullTimeEntitlementHalfDays * weekFraction * yearFraction);
}

/**
 * Bradford Factor: S² × D, where S is the number of separate absence occurrences and D the
 * total days lost across them.
 *
 * The squaring is the whole point — it weights many short absences far more heavily than one
 * long one, so eight one-day absences (8² × 8 = 512) scores far above one eight-day absence
 * (1² × 8 = 8). It is a prompt for a conversation, never an automatic sanction, which is why
 * nothing in this app acts on the score without a human.
 */
export function bradfordFactor(occurrences: number, totalDays: number): number {
  return occurrences * occurrences * totalDays;
}

/** Whether two inclusive date ranges overlap at all. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
