import { and, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  employees,
  employeeProfiles,
  leaveAllowances,
  leaveRequests,
  leaveSettings,
  leaveTypes,
  publicHolidays
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import {
  calculateBalance,
  leaveYearEndFor,
  leaveYearStartFor,
  proRataEntitlement,
  type LeaveBalance
} from '@/lib/hr/leave-calculation';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canListAllEmployees,
  hrScopeFor,
  isHrAdmin,
  isLineManagerOf
} from '@/lib/permissions/hr-access';

export type LeaveSettingsRow = typeof leaveSettings.$inferSelect;

/**
 * Company leave policy, creating the single row on first read.
 *
 * Lazily seeded rather than inserted by the migration: the migration runs against every
 * environment including a fresh test database, and a row created there would have to be
 * cleaned up by every test that counts rows. The unique constraint on `singleton` makes the
 * race between two concurrent first-readers harmless — the loser's insert is rejected and it
 * re-reads.
 */
export async function getLeaveSettings(): Promise<LeaveSettingsRow> {
  const [existing] = await db.select().from(leaveSettings).limit(1);
  if (existing) return existing;

  try {
    const [created] = await db.insert(leaveSettings).values({}).returning();
    return created;
  } catch {
    const [row] = await db.select().from(leaveSettings).limit(1);
    if (!row) throw new Error('Could not read or create leave settings');
    return row;
  }
}

export async function listLeaveTypes() {
  return db
    .select()
    .from(leaveTypes)
    .where(sql`${leaveTypes.archivedAt} is null`)
    .orderBy(leaveTypes.position, leaveTypes.name);
}

/** Public holiday dates inside a range, as plain ISO strings for the calculation module. */
export async function getPublicHolidayDates(from: string, to: string): Promise<string[]> {
  const rows = await db
    .select({ date: publicHolidays.date })
    .from(publicHolidays)
    .where(and(gte(publicHolidays.date, from), lte(publicHolidays.date, to)));
  return rows.map((row) => row.date);
}

export type LeaveYear = { start: string; end: string };

export async function currentLeaveYear(onDate?: string): Promise<LeaveYear> {
  const settings = await getLeaveSettings();
  const today = onDate ?? new Date().toISOString().slice(0, 10);
  const start = leaveYearStartFor(today, settings.leaveYearStartMonth, settings.leaveYearStartDay);
  return { start, end: leaveYearEndFor(start) };
}

/**
 * An employee's balance for a leave year.
 *
 * Only leave whose type `deductsFromAllowance` is counted — unpaid and compassionate leave are
 * recorded but do not draw down the allowance, which is the whole reason that flag exists.
 * Cancelled and declined requests are excluded; pending ones are counted separately so a new
 * request can be checked against what is genuinely still bookable.
 */
export async function getLeaveBalance(
  employeeId: string,
  year?: LeaveYear
): Promise<LeaveBalance & { year: LeaveYear; hasExplicitAllowance: boolean }> {
  const leaveYear = year ?? (await currentLeaveYear());
  const settings = await getLeaveSettings();

  const [allowance] = await db
    .select()
    .from(leaveAllowances)
    .where(
      and(
        eq(leaveAllowances.employeeId, employeeId),
        eq(leaveAllowances.leaveYearStart, leaveYear.start)
      )
    )
    .limit(1);

  // No explicit allowance row means nobody has set this person's entitlement for the year, so
  // fall back to the company default pro-rated by their contracted week. Surfaced to the UI via
  // `hasExplicitAllowance` rather than silently — an assumed entitlement should be visible as
  // an assumption, not presented as a decision someone made.
  let entitlementHalfDays = allowance?.entitlementHalfDays ?? null;
  if (entitlementHalfDays === null) {
    const [profile] = await db
      .select({ workingDaysPerWeek: employeeProfiles.workingDaysPerWeek })
      .from(employeeProfiles)
      .where(eq(employeeProfiles.employeeId, employeeId))
      .limit(1);

    entitlementHalfDays = proRataEntitlement({
      fullTimeEntitlementHalfDays: settings.defaultEntitlementHalfDays,
      workingDaysPerWeek: profile?.workingDaysPerWeek ?? null
    });
  }

  const rows = await db
    .select({
      status: leaveRequests.status,
      totalHalfDays: leaveRequests.totalHalfDays
    })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveTypes.deductsFromAllowance, true),
        inArray(leaveRequests.status, ['approved', 'pending']),
        // Overlap against the leave year rather than containment, so a request spanning the
        // year boundary is still counted rather than vanishing from both years.
        lte(leaveRequests.startDate, leaveYear.end),
        gte(leaveRequests.endDate, leaveYear.start)
      )
    );

  const takenHalfDays = rows
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + r.totalHalfDays, 0);
  const pendingHalfDays = rows
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + r.totalHalfDays, 0);

  return {
    ...calculateBalance({
      entitlementHalfDays,
      carriedOverHalfDays: allowance?.carriedOverHalfDays ?? 0,
      adjustmentHalfDays: allowance?.adjustmentHalfDays ?? 0,
      takenHalfDays,
      pendingHalfDays
    }),
    year: leaveYear,
    hasExplicitAllowance: Boolean(allowance)
  };
}

export type LeaveRequestRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeManagerId: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeColour: string | null;
  startDate: string;
  endDate: string;
  startUnit: 'full' | 'am' | 'pm';
  endUnit: 'full' | 'am' | 'pm';
  totalHalfDays: number;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  reason: string | null;
  decisionNote: string | null;
  autoApproved: boolean;
  createdAt: Date;
};

function leaveSelection() {
  return {
    id: leaveRequests.id,
    employeeId: leaveRequests.employeeId,
    employeeName: employeeDisplayName,
    employeeManagerId: employees.managerId,
    leaveTypeId: leaveRequests.leaveTypeId,
    leaveTypeName: leaveTypes.name,
    leaveTypeColour: leaveTypes.colour,
    startDate: leaveRequests.startDate,
    endDate: leaveRequests.endDate,
    startUnit: leaveRequests.startUnit,
    endUnit: leaveRequests.endUnit,
    totalHalfDays: leaveRequests.totalHalfDays,
    status: leaveRequests.status,
    reason: leaveRequests.reason,
    decisionNote: leaveRequests.decisionNote,
    autoApproved: leaveRequests.autoApproved,
    createdAt: leaveRequests.createdAt
  };
}

/**
 * Whose leave this caller may see, expressed as a SQL condition rather than a post-filter.
 * Undefined means "no restriction" and is passed straight to `and()`, which drops it.
 */
function leaveVisibility(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'all') return undefined;
  return or(eq(leaveRequests.employeeId, caller.id), eq(employees.managerId, caller.id));
}

export async function listLeaveRequestsForEmployee(
  employeeId: string,
  year?: LeaveYear
): Promise<LeaveRequestRow[]> {
  const leaveYear = year ?? (await currentLeaveYear());
  return db
    .select(leaveSelection())
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        lte(leaveRequests.startDate, leaveYear.end),
        gte(leaveRequests.endDate, leaveYear.start)
      )
    )
    .orderBy(leaveRequests.startDate);
}

/** The approval queue: pending requests this caller is entitled to decide. */
export async function listPendingApprovals(caller: ActiveEmployee): Promise<LeaveRequestRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const decidable =
    isHrAdmin(caller)
      ? // HR is the backstop for everyone, but must not be handed their own request to approve.
        ne(leaveRequests.employeeId, caller.id)
      : and(eq(employees.managerId, caller.id), ne(leaveRequests.employeeId, caller.id));

  return db
    .select(leaveSelection())
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.status, 'pending'), decidable))
    .orderBy(leaveRequests.startDate);
}

/**
 * Approved and pending leave across everyone the caller can see, for the wall planner.
 * Declined and cancelled requests are excluded — the planner answers "who is away", and a
 * request that was refused is not an answer to that.
 */
export async function listLeaveInRange(
  caller: ActiveEmployee,
  from: string,
  to: string
): Promise<LeaveRequestRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  return db
    .select(leaveSelection())
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        inArray(leaveRequests.status, ['approved', 'pending']),
        lte(leaveRequests.startDate, to),
        gte(leaveRequests.endDate, from),
        leaveVisibility(caller)
      )
    )
    .orderBy(leaveRequests.startDate);
}

/**
 * The window the "also away soon" list covers: today to two months out.
 *
 * Computed here rather than in the page so the page stays free of `Date.now()` during render —
 * a clock read at render time is exactly the impurity React's rules forbid, and it belongs in
 * the data layer regardless.
 */
export function upcomingLeaveWindow(days = 60): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now).toISOString().slice(0, 10),
    to: new Date(now + days * 86_400_000).toISOString().slice(0, 10)
  };
}

/**
 * Anyone already off during this range, among people the caller can see.
 *
 * Shown when booking so a team does not discover a clash after the fact. This is information,
 * not a block: overlapping leave is allowed, and refusing it automatically would be the
 * "automation decides" pattern engineering rule 1 rules out.
 */
export async function listClashingLeave(
  caller: ActiveEmployee,
  from: string,
  to: string
): Promise<LeaveRequestRow[]> {
  const rows = await listLeaveInRange(caller, from, to);
  return rows.filter((row) => row.employeeId !== caller.id);
}

export async function getLeaveRequestById(id: string): Promise<LeaveRequestRow | null> {
  const [row] = await db
    .select(leaveSelection())
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(eq(leaveRequests.id, id))
    .limit(1);
  return row ?? null;
}

/** Everyone the caller may book or decide leave for, for the "on behalf of" picker. */
export async function listLeaveSubjects(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  const visibility = canListAllEmployees(caller)
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
