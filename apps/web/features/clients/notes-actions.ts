'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { clientNotes, clientStaff, clients } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canViewClient } from '@/lib/permissions/client-access';
import { addClientNoteSchema, updateClientNoteSchema, type AddClientNoteInput, type UpdateClientNoteInput } from './utils/schemas';

// Notes are gated at "can view this client" — same bar as task comments, not the stricter
// "can edit" bar staff management uses. Editing/removing your own note is gated separately, at
// "you wrote it" (below), not at client-edit permission.
async function getViewableClientOrThrow(clientId: string) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new Error('Client not found');
  const caller = await requireActiveEmployee();
  const [staffRow] = await db
    .select({ id: clientStaff.id })
    .from(clientStaff)
    .where(and(eq(clientStaff.clientId, clientId), eq(clientStaff.employeeId, caller.id)))
    .limit(1);
  if (!canViewClient(caller, { id: client.id, team: client.team }, !!staffRow)) {
    throw new Error('Not permitted to view this client');
  }
  return caller;
}

export async function addClientNote(clientId: string, input: AddClientNoteInput) {
  const caller = await getViewableClientOrThrow(clientId);
  const parsed = addClientNoteSchema.parse(input);

  const [created] = await db
    .insert(clientNotes)
    .values({ clientId, authorEmployeeId: caller.id, body: parsed.body })
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_note_added',
    resourceType: 'client',
    resourceId: clientId,
    result: 'success',
    metadata: { noteId: created.id }
  });

  revalidatePath(`/dashboard/clients/${clientId}`);
  return created;
}

export async function updateClientNote(noteId: string, input: UpdateClientNoteInput) {
  const [note] = await db.select().from(clientNotes).where(eq(clientNotes.id, noteId)).limit(1);
  if (!note) throw new Error('Note not found');
  const caller = await requireActiveEmployee();
  if (note.authorEmployeeId !== caller.id) {
    throw new Error('Only the author can edit this note');
  }
  const parsed = updateClientNoteSchema.parse(input);

  const [updated] = await db
    .update(clientNotes)
    .set({ body: parsed.body, updatedAt: new Date() })
    .where(eq(clientNotes.id, noteId))
    .returning();

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_note_updated',
    resourceType: 'client',
    resourceId: note.clientId,
    result: 'success',
    metadata: { noteId }
  });

  revalidatePath(`/dashboard/clients/${note.clientId}`);
  return updated;
}

export async function removeClientNote(noteId: string) {
  const [note] = await db.select().from(clientNotes).where(eq(clientNotes.id, noteId)).limit(1);
  if (!note) throw new Error('Note not found');
  const caller = await requireActiveEmployee();
  if (note.authorEmployeeId !== caller.id && caller.role !== 'ADMIN') {
    throw new Error('Only the author or an ADMIN can remove this note');
  }

  await db.delete(clientNotes).where(eq(clientNotes.id, noteId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_note_removed',
    resourceType: 'client',
    resourceId: note.clientId,
    result: 'success',
    metadata: { noteId }
  });

  revalidatePath(`/dashboard/clients/${note.clientId}`);
}
