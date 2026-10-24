import { auth, currentUser } from '@clerk/nextjs/server';
import { eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ACCESS_CODE_PATH,
  ACCESS_COOKIE_NAME,
  accessCodeConfig,
  accessSessionIsValid,
  type AccessCodeConfig
} from '@/lib/auth/access-code';
import { db } from '@/lib/db/client';
import { resolveDisplayName } from '@/lib/db/display-name';
import { employees } from '@/lib/db/schema';
import { bootstrapEmployeeRow } from '@/lib/onboarding/bootstrap-employee';
import type { Role } from './roles';

export type EmployeeRow = typeof employees.$inferSelect;

export type ActiveEmployee = {
  id: string;
  clerkUserId: string;
  /** The account-of-record name, as Clerk supplied it at sign-up. Kept so an
   *  administrator can always tie a Hub row back to the real account; it is not
   *  what the interface renders. */
  name: string;
  /** What the Hub calls this person everywhere a human reads a name — the
   *  sidebar, the team roster, a task assignment, a chat message, HR, SYRIX AI.
   *  The same rule expressed in SQL as `employeeDisplayName` in
   *  `lib/db/display-name.ts`; change one and change the other. */
  displayName: string;
  email: string;
  role: Role;
  team: string | null;
  /** The caller's own line manager, if one is set. */
  managerId: string | null;
  /**
   * Breathe's "finance user" tier — pay figures and expense amounts, nothing else. Carried on
   * the session object because lib/permissions/hr-access.ts's predicates are pure functions of
   * the caller, and re-reading the flag inside each one would mean a database round trip per
   * check.
   */
  financeAccess: boolean;
  /**
   * HR administration granted as a capability rather than as the HR_ADMIN role — see the column
   * comment in schema.ts. Carried here for the same reason as financeAccess: hr-access.ts's
   * predicates are pure functions of the caller.
   */
  hrAdmin: boolean;
};

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Who the caller is when this deployment opens on a shared access code rather than a sign-in.
 *
 * Always the one account named by ACCESS_CODE_IDENTITY, and only ever an account that already
 * exists: nothing here creates or promotes a row. A code that opened an account into being would
 * be a code that grants access to a Hub nobody has approved anyone for.
 *
 * The session cookie is re-checked here even though proxy.ts already refused every request
 * without it. That check is one line of configuration away from not running — a matcher that
 * stops covering a path, a route that renders outside the proxy — and this is the function that
 * decides what the caller is allowed to see. It should not be the only one that assumes.
 */
async function accessCodeEmployeeRow(config: AccessCodeConfig): Promise<EmployeeRow | null> {
  const cookieStore = await cookies();
  if (!accessSessionIsValid(cookieStore.get(ACCESS_COOKIE_NAME)?.value)) return null;

  const [row] = await db
    .select()
    .from(employees)
    .where(sql`lower(${employees.email}) = ${config.identityEmail}`)
    .limit(1);

  // Thrown rather than returned as null, because null here means "signed in but not set up yet"
  // and would send the visitor to /onboarding — which in this mode redirects back to the code
  // screen, which they have already answered. A misconfigured identity would present as an
  // infinite loop with nothing in the logs to explain it. This says what is wrong instead.
  if (!row) {
    throw new Error(
      `ACCESS_CODE_IDENTITY is set to ${config.identityEmail}, which is not an employee in this database`
    );
  }

  return row;
}

// Raw row lookup, any status (including 'pending') — used by onboarding and admin screens
// that need to see an employee before they're active.
export async function getEmployeeRow(): Promise<EmployeeRow | null> {
  const codeMode = accessCodeConfig();
  if (codeMode) return accessCodeEmployeeRow(codeMode);

  const { userId } = await auth();
  if (!userId) return null;

  const [row] = await db.select().from(employees).where(eq(employees.clerkUserId, userId)).limit(1);
  if (row) return row;

  // No employees row yet. Normally the Clerk `user.created` webhook creates one, but that
  // webhook can only ever fire if Clerk's servers can reach this app over the internet — never
  // true for plain localhost dev (the engineering rules' "local now, cloud later": most of this project's
  // life is spent exactly there). Provision it here instead of leaving a real signed-in Clerk
  // user permanently stuck with no employees row and a misleading "pending approval" screen.
  const user = await currentUser();
  if (!user) return null;

  const primaryEmail =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    '';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || primaryEmail;

  return bootstrapEmployeeRow({ clerkUserId: userId, name, email: primaryEmail });
}

// Signed in, has an employees row, status 'active', and has a role assigned. This is the gate
// every server-side permission check should go through — never trust a client-supplied role.
export async function getCurrentEmployee(): Promise<ActiveEmployee | null> {
  const row = await getEmployeeRow();
  if (!row || row.status !== 'active' || !row.role) return null;

  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    name: row.name,
    displayName: resolveDisplayName(row),
    email: row.email,
    role: row.role,
    team: row.team,
    managerId: row.managerId,
    financeAccess: row.financeAccess,
    hrAdmin: row.hrAdmin
  };
}

export async function requireActiveEmployee(): Promise<ActiveEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) throw new ForbiddenError('No active employee record for this session');
  return employee;
}

export async function requireRole(...allowed: Role[]): Promise<ActiveEmployee> {
  const employee = await requireActiveEmployee();
  if (!allowed.includes(employee.role)) {
    throw new ForbiddenError(`Role ${employee.role} not permitted for this action`);
  }
  return employee;
}

// Page-level convenience for a Server Component that requires nothing beyond "an active
// employee" (no specific role) — dashboard/layout.tsx already redirects unauthenticated/
// pending/disabled/unverified-MFA sessions before a page renders, but a session-less request
// has been observed to still reach a page's own requireActiveEmployee() call and throw an
// uncaught ForbiddenError, racing the layout's own redirect. Every such page should call this
// instead of requireActiveEmployee directly, so that edge case redirects to sign-in instead of
// surfacing as an unhandled error.
export async function requireActiveEmployeeForPage(): Promise<ActiveEmployee> {
  try {
    return await requireActiveEmployee();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(accessCodeConfig() ? ACCESS_CODE_PATH : '/auth/sign-in');
    }
    throw err;
  }
}
