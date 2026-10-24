'use server';

import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireRole } from '@/lib/permissions/current-employee';
import { ROLES, type Role } from '@/lib/permissions/roles';
import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { clerkClient } from '@clerk/nextjs/server';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

/**
 * Refuses any change to who may use the Hub when this deployment opens on a shared access code.
 *
 * In that mode every session is the same administrator, so the permission check below passes for
 * whoever is holding the code — and the employees table is shared with the deployment people
 * actually work in. A single click here could refuse, disable or re-role a real account, and the
 * person it happened to would find out by being unable to sign in to the real Hub.
 */
function assertAccessChangesPermitted(): void {
  if (accessCodeModeEnabled()) {
    throw new Error('Access cannot be granted, refused or changed from an access-code deployment');
  }
}

function assertRole(value: string): asserts value is Role {
  if (!ROLES.includes(value as Role)) throw new Error(`Invalid role: ${value}`);
}

/**
 * Grants access, whatever the account's current state.
 *
 * This is the only path to 'active' and it deliberately covers all three ways in: a new request
 * (pending), one that was refused (rejected), and a former employee returning (disabled). The
 * last two both carry a Clerk ban, from `rejectEmployee` and `disableEmployee` respectively, and
 * nothing anywhere lifted it — so before this, an account that had ever been refused or disabled
 * could be set back to 'active' in the Hub's own table while Clerk went on refusing every
 * sign-in. The row said one thing, the person's experience said another, and no screen reported
 * the contradiction.
 */
export async function approveEmployee(employeeId: string, role: string, team: string) {
  assertAccessChangesPermitted();
  const admin = await requireRole('ADMIN');
  assertRole(role);

  const [target] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!target) throw new Error('Employee not found');

  const previousStatus = target.status;

  // Lifted before the row is updated, not after: if unbanning fails, the Hub must not be left
  // claiming an account is active that cannot sign in. A failure here reaches the administrator
  // with nothing yet changed.
  if (previousStatus === 'rejected' || previousStatus === 'disabled') {
    const client = await clerkClient();
    await client.users.unbanUser(target.clerkUserId);
  }

  const [updated] = await db
    .update(employees)
    .set({ role, team: team || null, status: 'active', updatedAt: new Date() })
    .where(eq(employees.id, employeeId))
    .returning();

  if (!updated) throw new Error('Employee not found');

  await logAuditEvent({
    actorEmployeeId: admin.id,
    action: 'employee_approved',
    resourceType: 'employee',
    resourceId: employeeId,
    result: 'success',
    metadata: { role, team: team || null, previousStatus }
  });

  revalidatePath('/dashboard/settings/access');
}

/**
 * Refuses a request for access that was never granted.
 *
 * Distinct from `disableEmployee` in both effect and meaning — see the note on
 * `employeeStatusEnum` in the schema. Restricted to 'pending' on purpose: withdrawing access from
 * somebody who has been working in the Hub is offboarding, which carries consequences this does
 * not handle (their assigned work has to go somewhere). Routing both through one action would
 * quietly leave that work owned by an account nobody can reach.
 */
export async function rejectEmployee(employeeId: string) {
  assertAccessChangesPermitted();
  const admin = await requireRole('ADMIN');

  const [target] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!target) throw new Error('Employee not found');

  if (target.status !== 'pending') {
    throw new Error('Only an account still waiting for approval can be refused');
  }

  // Banned at the identity provider, not only here. Without it a refused account keeps a valid
  // Clerk session and goes on reaching the Hub's own gate on every request — turned away each
  // time, but free to keep knocking.
  const client = await clerkClient();
  await client.users.banUser(target.clerkUserId);

  await db
    .update(employees)
    .set({ status: 'rejected', role: null, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  await logAuditEvent({
    actorEmployeeId: admin.id,
    action: 'employee_access_refused',
    resourceType: 'employee',
    resourceId: employeeId,
    result: 'success',
    metadata: { clerkUserId: target.clerkUserId, email: target.email }
  });

  revalidatePath('/dashboard/settings/access');
}

export async function updateEmployeeRoleTeam(employeeId: string, role: string, team: string) {
  assertAccessChangesPermitted();
  const admin = await requireRole('ADMIN');
  assertRole(role);

  const [updated] = await db
    .update(employees)
    .set({ role, team: team || null, updatedAt: new Date() })
    .where(eq(employees.id, employeeId))
    .returning();

  if (!updated) throw new Error('Employee not found');

  await logAuditEvent({
    actorEmployeeId: admin.id,
    action: 'employee_role_changed',
    resourceType: 'employee',
    resourceId: employeeId,
    result: 'success',
    metadata: { role, team: team || null }
  });

  revalidatePath('/dashboard/settings/access');
}

/**
 * Grant or withdraw the two capabilities that sit alongside a role rather than replacing it:
 * HR administration and finance access.
 *
 * Kept separate from updateEmployeeRoleTeam because they answer different questions, and one
 * screen that silently rewrote both would make an unrelated capability change every time an
 * administrator corrected somebody's team. The audit entry records only what actually moved.
 *
 * An ADMIN may grant these to themselves. That is the point: in a company where one person is
 * both the platform administrator and the person who runs HR, requiring a second administrator
 * to exist before HR can be configured at all would leave it permanently unconfigurable. The
 * grant is step-up authenticated and audited exactly like a role change, which is the control
 * that actually matters here.
 */
export async function updateEmployeeCapabilities(
  employeeId: string,
  capabilities: { hrAdmin: boolean; financeAccess: boolean }
) {
  assertAccessChangesPermitted();
  const admin = await requireRole('ADMIN');

  const [target] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!target) throw new Error('Employee not found');

  // A disabled account has no role and must not be handed a capability either — granting one
  // here would survive re-enablement without anyone deciding to grant it then.
  if (target.status !== 'active') {
    throw new Error('Capabilities can only be granted to an active employee');
  }

  // The same rule lib/permissions/hr-access.ts enforces at read time: a security administrator
  // is walled off from business and HR data, and a capability must never become a route around
  // that — including a capability staged now that only takes effect after a later role change.
  if (target.role === 'SECURITY_ADMIN' && (capabilities.hrAdmin || capabilities.financeAccess)) {
    throw new Error('A SECURITY_ADMIN cannot hold hrAdmin or financeAccess');
  }

  const changed = {
    hrAdmin: target.hrAdmin !== capabilities.hrAdmin ? capabilities.hrAdmin : undefined,
    financeAccess:
      target.financeAccess !== capabilities.financeAccess ? capabilities.financeAccess : undefined
  };

  if (changed.hrAdmin === undefined && changed.financeAccess === undefined) return;

  await db
    .update(employees)
    .set({
      hrAdmin: capabilities.hrAdmin,
      financeAccess: capabilities.financeAccess,
      updatedAt: new Date()
    })
    .where(eq(employees.id, employeeId));

  await logAuditEvent({
    actorEmployeeId: admin.id,
    action: 'employee_capabilities_changed',
    resourceType: 'employee',
    resourceId: employeeId,
    result: 'success',
    metadata: {
      ...(changed.hrAdmin !== undefined ? { hrAdmin: changed.hrAdmin } : {}),
      ...(changed.financeAccess !== undefined ? { financeAccess: changed.financeAccess } : {}),
      self: admin.id === employeeId
    }
  });

  revalidatePath('/dashboard/settings/access');
  // HR screens are gated on this, and they render under the dashboard layout — revalidate the
  // whole segment so a newly granted person does not have to reload to see the module appear.
  revalidatePath('/dashboard', 'layout');
}

// Offboarding (the build plan Phase 1): disable access, revoke sessions, strip role, preserve
// audit history — the employees row is never deleted. "Transfer assigned work" (Phase 2, now
// that Task exists): a disable action has no specific "reassign to" target implied, so rather
// than guess a new owner, every active task assigned to the disabled employee is unassigned —
// visible again to their team's TEAM_LEAD via team-scoped visibility (see task-access.ts) to
// hand off deliberately. Archived and already-done tasks are left alone; there's nothing to
// transfer on those.
export async function disableEmployee(employeeId: string) {
  assertAccessChangesPermitted();
  const admin = await requireRole('ADMIN');

  if (admin.id === employeeId) {
    throw new Error('You cannot disable your own account');
  }


  const [target] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!target) throw new Error('Employee not found');

  const client = await clerkClient();
  await client.users.banUser(target.clerkUserId);

  // Capabilities are stripped alongside the role. Leaving them set would mean a re-enabled
  // account silently came back holding HR administration that nobody granted it a second time.
  await db
    .update(employees)
    .set({
      status: 'disabled',
      role: null,
      hrAdmin: false,
      financeAccess: false,
      updatedAt: new Date()
    })
    .where(eq(employees.id, employeeId));

  const unassigned = await db
    .update(tasks)
    .set({ assigneeId: null, updatedAt: new Date() })
    .where(
      and(eq(tasks.assigneeId, employeeId), isNull(tasks.archivedAt), ne(tasks.status, 'done'))
    )
    .returning({ id: tasks.id });

  await logAuditEvent({
    actorEmployeeId: admin.id,
    action: 'employee_offboarded',
    resourceType: 'employee',
    resourceId: employeeId,
    result: 'success',
    metadata: {
      clerkUserId: target.clerkUserId,
      tasksUnassigned: unassigned.length
    }
  });

  revalidatePath('/dashboard/settings/access');
}
