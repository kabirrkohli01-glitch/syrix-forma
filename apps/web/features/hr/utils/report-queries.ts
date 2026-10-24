import { and, count, eq, gte, isNotNull, isNull, lte, not, sum } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  employeeProfiles,
  employees,
  expenseClaims,
  leaveRequests,
  leaveTypes,
  sicknessRecords,
  timesheetEntries,
  timesheets
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { isHrAdminRow } from '@/lib/db/hr-admin';
import { HALF_DAYS_PER_DAY } from '@/lib/hr/leave-calculation';
import { currentLeaveYear, getLeaveBalance, type LeaveYear } from './leave-queries';

/**
 * Minimum group size before a demographic figure is reported separately.
 *
 * Below this, a "breakdown by contract type" on a small company stops being a statistic and
 * becomes a way of identifying one person's data — the classic re-identification problem with
 * aggregate reporting. Groups under the threshold are collapsed into a single "small groups"
 * row rather than dropped, so the totals still add up and nobody concludes the data is wrong.
 */
export const SMALL_GROUP_THRESHOLD = 5;

export type HeadcountReport = {
  active: number;
  pending: number;
  startedThisYear: number;
  leftThisYear: number;
  /** Leavers as a percentage of average headcount over the period, rounded to one decimal. */
  turnoverPercent: number | null;
};

export async function getHeadcountReport(year: LeaveYear): Promise<HeadcountReport> {
  const [[active], [pending], [starters], [leavers]] = await Promise.all([
    db.select({ total: count() }).from(employees).where(eq(employees.status, 'active')),
    db.select({ total: count() }).from(employees).where(eq(employees.status, 'pending')),
    db
      .select({ total: count() })
      .from(employeeProfiles)
      .where(
        and(gte(employeeProfiles.startDate, year.start), lte(employeeProfiles.startDate, year.end))
      ),
    db
      .select({ total: count() })
      .from(employeeProfiles)
      .where(
        and(gte(employeeProfiles.endDate, year.start), lte(employeeProfiles.endDate, year.end))
      )
  ]);

  // Average headcount over the period, approximated as the midpoint between opening and
  // closing. A daily average would be more precise and needs a headcount history table that
  // does not exist; the approximation is stated rather than presented as exact.
  const closing = active.total;
  const opening = closing - starters.total + leavers.total;
  const averageHeadcount = (opening + closing) / 2;

  return {
    active: active.total,
    pending: pending.total,
    startedThisYear: starters.total,
    leftThisYear: leavers.total,
    turnoverPercent:
      averageHeadcount > 0 ? Math.round((leavers.total / averageHeadcount) * 1000) / 10 : null
  };
}

export type LeaveReportRow = {
  employeeId: string;
  employeeName: string;
  entitlementDays: number;
  takenDays: number;
  remainingDays: number;
};

/** Leave taken against entitlement, per person, for the leave year. */
export async function getLeaveReport(year: LeaveYear): Promise<LeaveReportRow[]> {
  const staff = await db
    .select({ id: employees.id, name: employeeDisplayName })
    .from(employees)
    .where(eq(employees.status, 'active'));

  const rows = await Promise.all(
    staff.map(async (person) => {
      const balance = await getLeaveBalance(person.id, year);
      return {
        employeeId: person.id,
        employeeName: person.name,
        entitlementDays: balance.totalHalfDays / HALF_DAYS_PER_DAY,
        takenDays: balance.takenHalfDays / HALF_DAYS_PER_DAY,
        remainingDays: balance.remainingHalfDays / HALF_DAYS_PER_DAY
      };
    })
  );

  return rows.toSorted((a, b) => b.takenDays - a.takenDays);
}

export type AbsenceReport = {
  totalAbsences: number;
  totalDaysLost: number;
  /** Days lost as a percentage of available working days across active staff. */
  absenceRatePercent: number | null;
  openAbsences: number;
};

export async function getAbsenceReport(year: LeaveYear): Promise<AbsenceReport> {
  const [[closed], [open], [headcount]] = await Promise.all([
    db
      .select({ total: count(), halfDays: sum(sicknessRecords.totalHalfDays) })
      .from(sicknessRecords)
      .where(
        and(
          gte(sicknessRecords.startDate, year.start),
          lte(sicknessRecords.startDate, year.end),
          isNotNull(sicknessRecords.endDate)
        )
      ),
    db.select({ total: count() }).from(sicknessRecords).where(isNull(sicknessRecords.endDate)),
    db.select({ total: count() }).from(employees).where(eq(employees.status, 'active'))
  ]);

  const daysLost = Number(closed.halfDays ?? 0) / HALF_DAYS_PER_DAY;
  // ~260 working days in a year per full-time person. An approximation, and labelled as a
  // rate rather than presented as an exact figure.
  const availableDays = headcount.total * 260;

  return {
    totalAbsences: closed.total,
    totalDaysLost: daysLost,
    absenceRatePercent:
      availableDays > 0 ? Math.round((daysLost / availableDays) * 1000) / 10 : null,
    openAbsences: open.total
  };
}

export type DemographicRow = { label: string; count: number; suppressed: boolean };

/**
 * A breakdown by contract type, with small groups collapsed.
 *
 * Everything below SMALL_GROUP_THRESHOLD is merged into one row rather than listed, because a
 * category containing one person is that person's record wearing a statistic's clothing.
 */
export async function getContractTypeBreakdown(): Promise<DemographicRow[]> {
  const rows = await db
    .select({ contractType: employeeProfiles.contractType, total: count() })
    .from(employeeProfiles)
    .innerJoin(employees, eq(employees.id, employeeProfiles.employeeId))
    .where(eq(employees.status, 'active'))
    .groupBy(employeeProfiles.contractType);

  const large: DemographicRow[] = [];
  let suppressedTotal = 0;

  for (const row of rows) {
    const label = row.contractType?.replaceAll('_', ' ') ?? 'Not recorded';
    if (row.total < SMALL_GROUP_THRESHOLD) {
      suppressedTotal += row.total;
    } else {
      large.push({ label, count: row.total, suppressed: false });
    }
  }

  if (suppressedTotal > 0) {
    large.push({
      label: `Groups smaller than ${SMALL_GROUP_THRESHOLD}`,
      count: suppressedTotal,
      suppressed: true
    });
  }

  return large.toSorted((a, b) => b.count - a.count);
}

export type BurnoutSignal = {
  employeeId: string;
  employeeName: string;
  leaveRemainingDays: number;
  absenceOccurrences: number;
  overtimeMinutes: number;
  reasons: string[];
};

/**
 * People showing more than one of the patterns that tend to precede burnout: holiday not
 * taken, repeated short absences, and consistently long weeks.
 *
 * Requires at least two signals before flagging, because any one of them alone has too many
 * innocent explanations — somebody saving leave for a big trip is not in trouble. Like the
 * Bradford score, this surfaces a conversation and nothing acts on it automatically.
 */
export async function getBurnoutSignals(year: LeaveYear): Promise<BurnoutSignal[]> {
  const staff = await db
    .select({ id: employees.id, name: employeeDisplayName })
    .from(employees)
    .where(eq(employees.status, 'active'));

  const signals = await Promise.all(
    staff.map(async (person) => {
      const [balance, [absence], [hours]] = await Promise.all([
        getLeaveBalance(person.id, year),
        db
          .select({ total: count() })
          .from(sicknessRecords)
          .where(
            and(
              eq(sicknessRecords.employeeId, person.id),
              gte(sicknessRecords.startDate, year.start),
              isNotNull(sicknessRecords.endDate)
            )
          ),
        db
          .select({ total: sum(timesheetEntries.minutes) })
          .from(timesheetEntries)
          .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
          .where(
            and(
              eq(timesheets.employeeId, person.id),
              gte(timesheetEntries.onDate, year.start),
              lte(timesheetEntries.onDate, year.end)
            )
          )
      ]);

      const leaveRemainingDays = balance.remainingHalfDays / HALF_DAYS_PER_DAY;
      const recordedMinutes = Number(hours.total ?? 0);
      // Against a 37.5-hour week over the weeks elapsed so far, not the whole year — comparing
      // April's hours to a full year's expectation would flag everyone every spring.
      const weeksElapsed = Math.max(
        1,
        Math.ceil(
          (Date.now() - new Date(`${year.start}T00:00:00.000Z`).getTime()) / (7 * 86_400_000)
        )
      );
      const expectedMinutes = weeksElapsed * 37.5 * 60;
      const overtimeMinutes = Math.max(recordedMinutes - expectedMinutes, 0);

      const reasons: string[] = [];
      if (leaveRemainingDays >= 15) reasons.push('most of their holiday still untaken');
      if (absence.total >= 3) reasons.push('several separate short absences');
      if (overtimeMinutes >= 20 * 60) reasons.push('consistently long weeks');

      return {
        employeeId: person.id,
        employeeName: person.name,
        leaveRemainingDays,
        absenceOccurrences: absence.total,
        overtimeMinutes,
        reasons
      };
    })
  );

  return signals
    .filter((signal) => signal.reasons.length >= 2)
    .toSorted((a, b) => b.reasons.length - a.reasons.length);
}

export type PayrollChange = {
  employeeId: string;
  employeeName: string;
  kind: 'starter' | 'leaver' | 'unpaid_leave' | 'approved_expenses' | 'timesheet_hours';
  detail: string;
  amount: string;
};

/**
 * Everything that affects what somebody is paid for a period, in one list.
 *
 * Deliberately does NOT include salary itself. A payroll run needs to know what *changed* —
 * who joined, who left, unpaid absence, expenses to reimburse, hours worked — and the standing
 * salary is already in the payroll system. Exporting every salary every month would widen the
 * blast radius of the file for no added use.
 */
export async function getPayrollChanges(from: string, to: string): Promise<PayrollChange[]> {
  const changes: PayrollChange[] = [];

  const starters = await db
    .select({
      employeeId: employees.id,
      name: employeeDisplayName,
      startDate: employeeProfiles.startDate
    })
    .from(employeeProfiles)
    .innerJoin(employees, eq(employees.id, employeeProfiles.employeeId))
    .where(and(gte(employeeProfiles.startDate, from), lte(employeeProfiles.startDate, to)));

  for (const row of starters) {
    changes.push({
      employeeId: row.employeeId,
      employeeName: row.name,
      kind: 'starter',
      detail: `Started ${row.startDate}`,
      amount: ''
    });
  }

  const leavers = await db
    .select({ employeeId: employees.id, name: employeeDisplayName, endDate: employeeProfiles.endDate })
    .from(employeeProfiles)
    .innerJoin(employees, eq(employees.id, employeeProfiles.employeeId))
    .where(and(gte(employeeProfiles.endDate, from), lte(employeeProfiles.endDate, to)));

  for (const row of leavers) {
    changes.push({
      employeeId: row.employeeId,
      employeeName: row.name,
      kind: 'leaver',
      detail: `Left ${row.endDate}`,
      amount: ''
    });
  }

  // Unpaid leave is the only leave type that changes pay, which is exactly what `isPaid` is
  // for — paid holiday does not belong in a payroll change file.
  const unpaid = await db
    .select({
      employeeId: employees.id,
      name: employeeDisplayName,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalHalfDays: leaveRequests.totalHalfDays
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.status, 'approved'),
        eq(leaveTypes.isPaid, false),
        gte(leaveRequests.startDate, from),
        lte(leaveRequests.startDate, to)
      )
    );

  for (const row of unpaid) {
    changes.push({
      employeeId: row.employeeId,
      employeeName: row.name,
      kind: 'unpaid_leave',
      detail: `${row.startDate} to ${row.endDate}`,
      amount: String(row.totalHalfDays / HALF_DAYS_PER_DAY)
    });
  }

  const expenses = await db
    .select({
      employeeId: employees.id,
      name: employeeDisplayName,
      title: expenseClaims.title,
      totalPence: expenseClaims.totalPence
    })
    .from(expenseClaims)
    .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
    .where(
      and(
        eq(expenseClaims.status, 'approved'),
        gte(expenseClaims.updatedAt, new Date(`${from}T00:00:00.000Z`)),
        lte(expenseClaims.updatedAt, new Date(`${to}T23:59:59.999Z`))
      )
    );

  for (const row of expenses) {
    changes.push({
      employeeId: row.employeeId,
      employeeName: row.name,
      kind: 'approved_expenses',
      detail: row.title,
      // Pounds with two decimals for the payroll system's benefit, converted once, here.
      amount: (row.totalPence / 100).toFixed(2)
    });
  }

  const hours = await db
    .select({
      employeeId: employees.id,
      name: employeeDisplayName,
      weekStart: timesheets.weekStart,
      minutes: sum(timesheetEntries.minutes)
    })
    .from(timesheets)
    .innerJoin(employees, eq(employees.id, timesheets.employeeId))
    .innerJoin(timesheetEntries, eq(timesheetEntries.timesheetId, timesheets.id))
    .where(
      and(
        eq(timesheets.status, 'approved'),
        gte(timesheets.weekStart, from),
        lte(timesheets.weekStart, to)
      )
    )
    .groupBy(employees.id, employeeDisplayName, timesheets.weekStart);

  for (const row of hours) {
    changes.push({
      employeeId: row.employeeId,
      employeeName: row.name,
      kind: 'timesheet_hours',
      detail: `Week of ${row.weekStart}`,
      amount: (Number(row.minutes ?? 0) / 60).toFixed(2)
    });
  }

  return changes.toSorted(
    (a, b) => a.employeeName.localeCompare(b.employeeName) || a.kind.localeCompare(b.kind)
  );
}

export async function currentReportingYear(): Promise<LeaveYear> {
  return currentLeaveYear();
}

/** Active employees who have no line manager set — nobody to approve their leave. */
export async function countEmployeesWithoutManager(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(employees)
    .where(
      // HR administrators are excluded rather than counted as a gap: their own leave is decided
      // by another HR administrator, so having no line manager set is not a routing problem for
      // them the way it is for everyone else.
      and(eq(employees.status, 'active'), isNull(employees.managerId), not(isHrAdminRow))
    );
  return row.total;
}
