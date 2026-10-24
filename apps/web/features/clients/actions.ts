'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { clientStaff, clients } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee, requireRole } from '@/lib/permissions/current-employee';
import { teamForNewRecord } from '@/lib/permissions/default-team';
import {
  canEditClient,
  canManageClientStaff,
  type ClientTarget
} from '@/lib/permissions/client-access';
import {
  clientStaffAssignmentSchema,
  createClientSchema,
  updateClientSchema,
  type ClientStaffAssignmentInput,
  type CreateClientInput,
  type UpdateClientInput
} from './utils/schemas';

async function getClientOrThrow(clientId: string) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new Error('Client not found');
  return client;
}

async function isCallerStaffed(clientId: string, employeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: clientStaff.id })
    .from(clientStaff)
    .where(and(eq(clientStaff.clientId, clientId), eq(clientStaff.employeeId, employeeId)))
    .limit(1);
  return !!row;
}

// Client creation is TEAM_LEAD+, not open to every EMPLOYEE — same reasoning as
// canManageClientStaff: standing up a new client record is a team-lead-level action.
export async function createClient(input: CreateClientInput) {
  const caller = await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  const parsed = createClientSchema.parse(input);

  let team = teamForNewRecord(caller.team);
  if (parsed.team && parsed.team !== team) {
    if (caller.role !== 'ADMIN') {
      throw new Error('Only an ADMIN can create a client outside your own team');
    }
    team = parsed.team;
  }

  const [created] = await db
    .insert(clients)
    .values({ name: parsed.name, serviceLine: parsed.serviceLine ?? null, team })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_created',
    resourceType: 'client',
    resourceId: created.id,
    result: 'success',
    metadata: { team }
  });

  revalidatePath('/dashboard/clients');
  return created;
}

export async function updateClient(clientId: string, input: UpdateClientInput) {
  const caller = await requireActiveEmployee();
  const parsed = updateClientSchema.parse(input);
  const client = await getClientOrThrow(clientId);
  const target: ClientTarget = { id: client.id, team: client.team };
  const staffed = await isCallerStaffed(clientId, caller.id);

  if (!canEditClient(caller, target, staffed)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'client_updated',
      resourceType: 'client',
      resourceId: clientId,
      result: 'denied'
    });
    throw new Error('Not permitted to edit this client');
  }

  if (parsed.team && parsed.team !== client.team && caller.role !== 'ADMIN') {
    throw new Error("Only an ADMIN can change a client's team");
  }

  const [updated] = await db
    .update(clients)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(clients.id, clientId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_updated',
    resourceType: 'client',
    resourceId: clientId,
    result: 'success',
    metadata: { fields: Object.keys(parsed) }
  });

  revalidatePath('/dashboard/clients');
  revalidatePath(`/dashboard/clients/${clientId}`);
  return updated;
}

export async function assignStaffToClient(clientId: string, input: ClientStaffAssignmentInput) {
  const caller = await requireActiveEmployee();
  const parsed = clientStaffAssignmentSchema.parse(input);
  const client = await getClientOrThrow(clientId);
  const target: ClientTarget = { id: client.id, team: client.team };

  if (!canManageClientStaff(caller, target)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'client_staff_assigned',
      resourceType: 'client',
      resourceId: clientId,
      result: 'denied'
    });
    throw new Error('Not permitted to manage staff on this client');
  }

  await db
    .insert(clientStaff)
    .values({ clientId, employeeId: parsed.employeeId })
    .onConflictDoNothing({ target: [clientStaff.clientId, clientStaff.employeeId] });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_staff_assigned',
    resourceType: 'client',
    resourceId: clientId,
    result: 'success',
    metadata: { employeeId: parsed.employeeId }
  });

  revalidatePath(`/dashboard/clients/${clientId}`);
}

export async function removeStaffFromClient(clientId: string, input: ClientStaffAssignmentInput) {
  const caller = await requireActiveEmployee();
  const parsed = clientStaffAssignmentSchema.parse(input);
  const client = await getClientOrThrow(clientId);
  const target: ClientTarget = { id: client.id, team: client.team };

  if (!canManageClientStaff(caller, target)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'client_staff_removed',
      resourceType: 'client',
      resourceId: clientId,
      result: 'denied'
    });
    throw new Error('Not permitted to manage staff on this client');
  }

  await db
    .delete(clientStaff)
    .where(and(eq(clientStaff.clientId, clientId), eq(clientStaff.employeeId, parsed.employeeId)));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_staff_removed',
    resourceType: 'client',
    resourceId: clientId,
    result: 'success',
    metadata: { employeeId: parsed.employeeId }
  });

  revalidatePath(`/dashboard/clients/${clientId}`);
}
