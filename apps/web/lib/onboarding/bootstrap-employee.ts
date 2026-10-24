import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';

export type EmployeeRow = typeof employees.$inferSelect;

/**
 * Whether this sign-up is the installation's first administrator.
 *
 * Every account that signs up waits for approval. That rule has exactly one hole in it, and it
 * has to: the very first account has nobody to approve it, so an installation with no
 * administrator could never get one and the Hub would be unusable by anyone for ever.
 *
 * The hole is as small as it can be made. It is not "the first person to find the link" — on a
 * publicly reachable deployment that is a stranger, and it hands them the account that grants
 * every other account its role. It is one named address, set deliberately by whoever deploys
 * this, and only while the installation genuinely has nobody in it. Once an administrator
 * exists, no email bypasses approval, including this one.
 */
function isFoundingAdministrator(email: string, employeeCount: number): boolean {
  if (employeeCount > 0) return false;

  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return false;

  return email.trim().toLowerCase() === owner;
}

// Shared by the Clerk `user.created` webhook (app/api/webhooks/clerk/route.ts) and
// getEmployeeRow's lazy-provisioning fallback (lib/permissions/current-employee.ts) — same
// insert, same rule, same audit entry, whichever caller gets there first.
// `onConflictDoNothing` + the re-select below make this safe to call from both places for the
// same user without producing two rows or two audit entries.
export async function bootstrapEmployeeRow(input: {
  clerkUserId: string;
  name: string;
  email: string;
}): Promise<EmployeeRow> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(employees);
  const isFirstEmployee = isFoundingAdministrator(input.email, count);

  const [created] = await db
    .insert(employees)
    .values({
      clerkUserId: input.clerkUserId,
      name: input.name,
      email: input.email,
      role: isFirstEmployee ? 'ADMIN' : null,
      status: isFirstEmployee ? 'active' : 'pending'
    })
    .onConflictDoNothing({ target: employees.clerkUserId })
    .returning();

  if (created) {
    await logAuditEvent({
      actorEmployeeId: created.id,
      action: isFirstEmployee ? 'bootstrap_admin_created' : 'employee_onboarding_started',
      resourceType: 'employee',
      resourceId: created.id,
      result: 'success'
    });
    return created;
  }

  // Lost the race to whichever caller inserted it first — return the row that's actually
  // there instead of treating this as a failure.
  const [row] = await db
    .select()
    .from(employees)
    .where(eq(employees.clerkUserId, input.clerkUserId))
    .limit(1);
  if (!row) throw new Error('Failed to provision employee row');
  return row;
}
