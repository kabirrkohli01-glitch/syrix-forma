import { and, eq, gte, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  absenceTriggerSettings,
  employees,
  returnToWorkInterviews,
  sicknessRecords
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { bradfordFactor, HALF_DAYS_PER_DAY } from '@/lib/hr/leave-calculation';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canViewAbsenceMedicalDetail,
  hrScopeFor,
  isLineManagerOf
} from '@/lib/permissions/hr-access';

export type AbsenceTriggerSettingsRow = typeof absenceTriggerSettings.$inferSelect;

/** Same lazily-seeded singleton pattern as getLeaveSettings. */
export async function getAbsenceTriggerSettings(): Promise<AbsenceTriggerSettingsRow> {
  const [existing] = await db.select().from(absenceTriggerSettings).limit(1);
  if (existing) return existing;

  try {
    const [created] = await db.insert(absenceTriggerSettings).values({}).returning();
    return created;
  } catch {
    const [row] = await db.select().from(absenceTriggerSettings).limit(1);
    if (!row) throw new Error('Could not read or create absence trigger settings');
    return row;
  }
}

export type AbsenceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeManagerId: string | null;
  startDate: string;
  endDate: string | null;
  totalHalfDays: number | null;
  isSelfCertified: boolean;
  hasFitNote: boolean;
  hasReturnToWork: boolean;
  /**
   * Health detail. Null when the caller is not entitled to it — a line manager sees that
   * someone was off and for how long, never why. Redacted in the query rather than in the
   * component, so it is not shipped to the browser at all.
   */
  medical: { category: string | null; notes: string | null } | null;
};

function absenceVisibility(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'all') return undefined;
  return or(eq(sicknessRecords.employeeId, caller.id), eq(employees.managerId, caller.id));
}

/**
 * Absence records the caller may see, redacted per row.
 *
 * The redaction happens here because entitlement to the medical band is per-subject, not per
 * caller: a line manager sees their own reason (they are the subject) but not their report's.
 * One boolean computed at the top of the function would get that wrong.
 */
export async function listAbsenceRecords(
  caller: ActiveEmployee,
  options: { since?: string; openOnly?: boolean } = {}
): Promise<AbsenceRow[]> {
  if (hrScopeFor(caller) === 'none') return [];

  const rows = await db
    .select({
      id: sicknessRecords.id,
      employeeId: sicknessRecords.employeeId,
      employeeName: employeeDisplayName,
      employeeManagerId: employees.managerId,
      startDate: sicknessRecords.startDate,
      endDate: sicknessRecords.endDate,
      totalHalfDays: sicknessRecords.totalHalfDays,
      isSelfCertified: sicknessRecords.isSelfCertified,
      fitNoteStorageKey: sicknessRecords.fitNoteStorageKey,
      category: sicknessRecords.category,
      notes: sicknessRecords.notes,
      returnToWorkId: returnToWorkInterviews.id
    })
    .from(sicknessRecords)
    .innerJoin(employees, eq(employees.id, sicknessRecords.employeeId))
    .leftJoin(
      returnToWorkInterviews,
      eq(returnToWorkInterviews.sicknessRecordId, sicknessRecords.id)
    )
    .where(
      and(
        absenceVisibility(caller),
        options.since ? gte(sicknessRecords.startDate, options.since) : undefined,
        options.openOnly ? isNull(sicknessRecords.endDate) : undefined
      )
    )
    .orderBy(sicknessRecords.startDate);

  return rows
    .map((row) => {
      const maySeeMedical = canViewAbsenceMedicalDetail(caller, {
        id: row.employeeId,
        managerId: row.employeeManagerId
      });
      return {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        employeeManagerId: row.employeeManagerId,
        startDate: row.startDate,
        endDate: row.endDate,
        totalHalfDays: row.totalHalfDays,
        isSelfCertified: row.isSelfCertified,
        hasFitNote: Boolean(row.fitNoteStorageKey),
        hasReturnToWork: Boolean(row.returnToWorkId),
        medical: maySeeMedical ? { category: row.category, notes: row.notes } : null
      };
    })
    .toReversed();
}

export type AbsenceTrigger = {
  employeeId: string;
  employeeName: string;
  occurrences: number;
  totalDays: number;
  bradfordScore: number;
  breachedBradford: boolean;
  breachedOccurrences: boolean;
};

/**
 * Bradford Factor scores over the configured rolling window, for everyone the caller may see.
 *
 * Deliberately reports the score and whether it crosses a threshold, and stops there. Nothing
 * in this app acts on it: the score is a prompt for a conversation, and an automated sanction
 * driven by an absence pattern is exactly the "automation decides" behaviour the engineering rules
 * Section 1 rules out. Only closed absences count — an absence still running has no final
 * length, and including it would make the score jump around day by day.
 */
export async function listAbsenceTriggers(caller: ActiveEmployee): Promise<AbsenceTrigger[]> {
  const scope = hrScopeFor(caller);
  if (scope === 'none') return [];

  const settings = await getAbsenceTriggerSettings();
  const since = new Date(Date.now() - settings.rollingWindowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = await db
    .select({
      employeeId: sicknessRecords.employeeId,
      employeeName: employeeDisplayName,
      employeeManagerId: employees.managerId,
      totalHalfDays: sicknessRecords.totalHalfDays
    })
    .from(sicknessRecords)
    .innerJoin(employees, eq(employees.id, sicknessRecords.employeeId))
    .where(
      and(
        gte(sicknessRecords.startDate, since),
        // Closed absences only. One still running has no final length, so including it would
        // make the score climb every day the person stays off and drop when they return.
        isNotNull(sicknessRecords.endDate),
        scope === 'all' ? undefined : eq(employees.managerId, caller.id)
      )
    );

  const byEmployee = new Map<string, { name: string; occurrences: number; halfDays: number }>();
  for (const row of rows) {
    if (row.totalHalfDays === null) continue;
    const current = byEmployee.get(row.employeeId) ?? {
      name: row.employeeName,
      occurrences: 0,
      halfDays: 0
    };
    current.occurrences += 1;
    current.halfDays += row.totalHalfDays;
    byEmployee.set(row.employeeId, current);
  }

  return [...byEmployee.entries()]
    .map(([employeeId, value]) => {
      const totalDays = value.halfDays / HALF_DAYS_PER_DAY;
      const bradfordScore = bradfordFactor(value.occurrences, totalDays);
      return {
        employeeId,
        employeeName: value.name,
        occurrences: value.occurrences,
        totalDays,
        bradfordScore,
        breachedBradford:
          settings.bradfordThreshold > 0 && bradfordScore >= settings.bradfordThreshold,
        breachedOccurrences:
          settings.occurrenceThreshold > 0 && value.occurrences >= settings.occurrenceThreshold
      };
    })
    .filter((row) => row.breachedBradford || row.breachedOccurrences)
    .toSorted((a, b) => b.bradfordScore - a.bradfordScore);
}

/** Who the caller may record an absence against. */
export async function listAbsenceSubjects(caller: ActiveEmployee) {
  if (hrScopeFor(caller) === 'none') return [];

  const visibility =
    hrScopeFor(caller) === 'all'
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
