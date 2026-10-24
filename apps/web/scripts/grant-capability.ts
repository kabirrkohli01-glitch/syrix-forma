/**
 * Grants or withdraws an HR administration / finance capability from the command line.
 *
 *   npm run grant -- someone@example.com hrAdmin on
 *   npm run grant -- someone@example.com financeAccess off
 *
 * The screen in Settings → People & Access is the normal way to do this, and it should stay the
 * normal way — it is step-up authenticated, which this is not. This exists for the one case the
 * screen cannot serve: the very first grant in an installation where nobody yet holds the
 * capability, which is exactly the state that made the whole HR module unreachable.
 *
 * It writes the same audit entry the action does, with `viaScript: true` recorded, so a grant
 * made this way is never indistinguishable from one made in the app.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';

const CAPABILITIES = ['hrAdmin', 'financeAccess'] as const;
type Capability = (typeof CAPABILITIES)[number];

async function main() {
  const [email, capability, state] = process.argv.slice(2);

  if (!email || !CAPABILITIES.includes(capability as Capability) || !['on', 'off'].includes(state)) {
    console.error(`Usage: npm run grant -- <email> <${CAPABILITIES.join('|')}> <on|off>`);
    process.exit(1);
  }

  const [person] = await db.select().from(employees).where(eq(employees.email, email)).limit(1);
  if (!person) {
    console.error(`No employee with email ${email}`);
    process.exit(1);
  }

  // The same rule the predicate enforces: a security administrator is walled off from business
  // and HR data, and a capability must never become a route around that.
  if (person.role === 'SECURITY_ADMIN') {
    console.error('A SECURITY_ADMIN cannot hold this capability — see lib/permissions/hr-access.ts');
    process.exit(1);
  }
  if (person.status !== 'active') {
    console.error(`${email} is ${person.status}, not active — approve the account first`);
    process.exit(1);
  }

  const enabled = state === 'on';
  const field = capability as Capability;

  if (person[field] === enabled) {
    console.log(`${email} already has ${field} ${state}. Nothing changed.`);
    process.exit(0);
  }

  await db
    .update(employees)
    .set({ [field]: enabled, updatedAt: new Date() })
    .where(eq(employees.id, person.id));

  await logAuditEvent({
    actorEmployeeId: person.id,
    action: 'employee_capabilities_changed',
    resourceType: 'employee',
    resourceId: person.id,
    result: 'success',
    metadata: { [field]: enabled, self: true, viaScript: true }
  });

  console.log(`${email}: ${field} is now ${state}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
