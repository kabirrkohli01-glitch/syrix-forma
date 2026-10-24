import { and, eq, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employeePay, employeeProfiles, employees } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { decryptOptionalHrField } from '@/lib/hr/crypto';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canListAllEmployees,
  canOpenEmployeeRecord,
  canViewEmployeeIdentity,
  canViewEmployeePay,
  canViewEmployeeRecord,
  hrScopeFor
} from '@/lib/permissions/hr-access';

export type HrPersonListRow = {
  id: string;
  name: string;
  jobTitle: string | null;
  team: string | null;
  managerId: string | null;
  isSelf: boolean;
};

/**
 * The people this caller may see at all. Scope comes from hr-access.ts, not from
 * `scopeForBusinessData` — see the header of that file for why HR cannot use the team scope
 * every other resource uses.
 *
 * Filtering happens in the SQL `where` rather than by fetching everyone and filtering in
 * JavaScript: a permission check applied after the rows have already left the database is not
 * a control, and engineering rule 15 rules out loading the whole company to render one page.
 */
export async function listVisibleEmployees(caller: ActiveEmployee): Promise<HrPersonListRow[]> {
  const scope = hrScopeFor(caller);
  if (scope === 'none') return [];

  // HR_ADMIN and finance users need no additional predicate beyond the status filter applied
  // below — they see everyone by name. What they can then read about each person is decided
  // per band in getEmployeeHrRecord, which is why a finance user appearing here does not imply
  // they can read anything beyond pay. 'pending' accounts are deliberately included: someone
  // hired but not yet through onboarding is exactly who HR needs to be able to find.
  const visibility = canListAllEmployees(caller)
    ? undefined
    : or(eq(employees.id, caller.id), eq(employees.managerId, caller.id));

  const rows = await db
    .select({
      id: employees.id,
      name: employeeDisplayName,
      team: employees.team,
      managerId: employees.managerId,
      jobTitle: employeeProfiles.jobTitle
    })
    .from(employees)
    .leftJoin(employeeProfiles, eq(employeeProfiles.employeeId, employees.id))
    .where(and(visibility, ne(employees.status, 'disabled')));

  return rows
    .map((row) => ({ ...row, isSelf: row.id === caller.id }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export type HrEmployeeRecord = {
  id: string;
  name: string;
  email: string;
  team: string | null;
  managerId: string | null;
  managerName: string | null;
  /** Employment band — null when the caller is not entitled to it (for example a finance user). */
  employment: {
    jobTitle: string | null;
    contractType: string | null;
    startDate: string | null;
    probationEndDate: string | null;
    endDate: string | null;
    workingDaysPerWeek: number | null;
    workingHoursPerWeek: number | null;
  } | null;
  /** Identity band — null when the caller is not entitled to it. */
  identity: {
    dateOfBirth: string | null;
    nationalInsurance: string | null;
    personalEmail: string | null;
    personalPhone: string | null;
    address: string[];
    emergencyContactName: string | null;
    emergencyContactRelationship: string | null;
    emergencyContactPhone: string | null;
  } | null;
  /** Pay band — null when the caller is not entitled to it. */
  pay: {
    annualSalary: string | null;
    hourlyRate: string | null;
    currency: string;
    payFrequency: string | null;
    effectiveFrom: string | null;
  } | null;
};

/**
 * One person's HR record, assembled band by band.
 *
 * The bands are decided here, server-side, and a band the caller is not entitled to is never
 * read out of the database rather than being fetched and hidden in the UI — hiding a field in
 * the markup still ships it to the browser, which engineering rule 10 explicitly does not
 * count as a control. Returns null when the caller may not see the person at all, so a caller
 * cannot distinguish "no such employee" from "not yours to see".
 */
export async function getEmployeeHrRecord(
  caller: ActiveEmployee,
  employeeId: string
): Promise<HrEmployeeRecord | null> {
  const [row] = await db
    .select({
      id: employees.id,
      name: employeeDisplayName,
      email: employees.email,
      team: employees.team,
      managerId: employees.managerId,
      status: employees.status
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!row) return null;

  const target = { id: row.id, managerId: row.managerId };
  if (!canOpenEmployeeRecord(caller, target)) return null;

  const [profile] = await db
    .select()
    .from(employeeProfiles)
    .where(eq(employeeProfiles.employeeId, employeeId))
    .limit(1);

  let managerName: string | null = null;
  if (row.managerId) {
    const [manager] = await db
      .select({ name: employeeDisplayName })
      .from(employees)
      .where(eq(employees.id, row.managerId))
      .limit(1);
    managerName = manager?.name ?? null;
  }

  const record: HrEmployeeRecord = {
    id: row.id,
    name: row.name,
    email: row.email,
    team: row.team,
    managerId: row.managerId,
    managerName,
    employment: canViewEmployeeRecord(caller, target)
      ? {
          jobTitle: profile?.jobTitle ?? null,
          contractType: profile?.contractType ?? null,
          startDate: profile?.startDate ?? null,
          probationEndDate: profile?.probationEndDate ?? null,
          endDate: profile?.endDate ?? null,
          workingDaysPerWeek: profile?.workingDaysPerWeek ?? null,
          workingHoursPerWeek: profile?.workingHoursPerWeek ?? null
        }
      : null,
    identity: null,
    pay: null
  };

  // A null band means "you may not see this", and nothing else. When the caller is entitled to
  // a band that has no row behind it yet, the band is still returned with null fields — so the
  // screen can distinguish "withheld from you" from "nobody has filled this in", which are very
  // different things to tell someone about their own record.
  if (canViewEmployeeIdentity(caller, target)) {
    record.identity = {
      dateOfBirth: profile?.dateOfBirth ?? null,
      nationalInsurance: decryptOptionalHrField(profile?.nationalInsuranceEncrypted),
      personalEmail: profile?.personalEmail ?? null,
      personalPhone: profile?.personalPhone ?? null,
      address: [
        profile?.addressLine1,
        profile?.addressLine2,
        profile?.addressCity,
        profile?.addressPostcode,
        profile?.addressCountry
      ].filter((part): part is string => Boolean(part)),
      emergencyContactName: profile?.emergencyContactName ?? null,
      emergencyContactRelationship: profile?.emergencyContactRelationship ?? null,
      emergencyContactPhone: profile?.emergencyContactPhone ?? null
    };
  }

  if (canViewEmployeePay(caller, target)) {
    const [pay] = await db
      .select()
      .from(employeePay)
      .where(eq(employeePay.employeeId, employeeId))
      .limit(1);

    record.pay = {
      annualSalary: decryptOptionalHrField(pay?.annualSalaryEncrypted),
      hourlyRate: decryptOptionalHrField(pay?.hourlyRateEncrypted),
      currency: pay?.currency ?? 'GBP',
      payFrequency: pay?.payFrequency ?? null,
      effectiveFrom: pay?.effectiveFrom ?? null
    };
  }

  return record;
}
