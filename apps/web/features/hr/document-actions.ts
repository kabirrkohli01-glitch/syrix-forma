'use server';

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, hrDocumentAcknowledgements, hrDocuments } from '@/lib/db/schema';
import { createNotification } from '@/lib/notifications/in-app';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import {
  canAcknowledgeHrDocument,
  canManageHrDocuments,
  canViewHrDocument
} from '@/lib/permissions/hr-access';
import { getStorageAdapter } from '@/lib/storage';
import { HrError } from './utils/errors';

/**
 * Types an HR document may be. Deliberately a short allowlist rather than "anything the
 * browser reports": the MIME type arrives from the client and is not evidence of anything, so
 * the narrower the set the less there is to go wrong when it lies.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain'
]);

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Loose comparison for the typed-name check: case and internal spacing vary between how
 * someone types their name and how it is stored, and failing them over a double space would
 * be pedantry rather than a control.
 */
function normaliseName(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
}

const requestUploadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    visibility: z.enum(['company', 'employee']),
    employeeId: z.uuid().optional(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
    requiresAcknowledgement: z.boolean().default(false)
  })
  .refine((value) => value.visibility === 'company' || Boolean(value.employeeId), {
    message: 'A personal document needs an employee',
    path: ['employeeId']
  });

/**
 * Creates the metadata row and hands back a pre-signed URL for the browser to PUT the bytes to.
 * Same two-step shape Team Chat attachments use — the file never passes through this server.
 */
export async function requestHrDocumentUpload(input: z.input<typeof requestUploadSchema>) {
  const caller = await requireActiveEmployee();
  if (!canManageHrDocuments(caller)) {
    throw new HrError('Only HR can upload documents');
  }

  const parsed = requestUploadSchema.parse(input);
  if (!ALLOWED_MIME_TYPES.has(parsed.mimeType)) {
    throw new HrError('That file type is not accepted');
  }

  if (parsed.visibility === 'employee' && parsed.employeeId) {
    const [subject] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, parsed.employeeId))
      .limit(1);
    if (!subject) throw new HrError('That employee record is not available');
  }

  // Random key, never the filename: a user-supplied name in a storage path is a traversal and
  // collision risk, and the real name is kept in the row for display.
  const storageKey = `hr-documents/${randomUUID()}`;

  const [created] = await db
    .insert(hrDocuments)
    .values({
      title: parsed.title,
      description: parsed.description ?? null,
      visibility: parsed.visibility,
      employeeId: parsed.visibility === 'employee' ? (parsed.employeeId ?? null) : null,
      storageKey,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      requiresAcknowledgement: parsed.requiresAcknowledgement,
      uploadedByEmployeeId: caller.id
    })
    .returning();

  const target = await getStorageAdapter().createUploadUrl(storageKey, parsed.mimeType);

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_document_uploaded',
    resourceType: 'hr_document',
    resourceId: created.id,
    result: 'success',
    metadata: { visibility: parsed.visibility, subjectEmployeeId: parsed.employeeId ?? null }
  });

  if (parsed.visibility === 'employee' && parsed.employeeId) {
    await createNotification({
      employeeId: parsed.employeeId,
      type: 'hr_document_shared',
      title: 'A document was added to your record',
      body: parsed.title,
      link: '/dashboard/hr/documents'
    });
  }

  revalidatePath('/dashboard/hr/documents');
  return { documentId: created.id, upload: target };
}

/** A short-lived download URL, issued only after the caller's entitlement is re-checked. */
export async function getHrDocumentDownloadUrl(input: { documentId: string }) {
  const caller = await requireActiveEmployee();

  const [document] = await db
    .select()
    .from(hrDocuments)
    .where(eq(hrDocuments.id, input.documentId))
    .limit(1);
  if (!document || document.archivedAt) throw new HrError('That document is not available');

  if (!canViewHrDocument(caller, document)) {
    // Same message whether it does not exist or is not theirs — a distinct refusal would
    // confirm the document exists.
    throw new HrError('That document is not available');
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_document_downloaded',
    resourceType: 'hr_document',
    resourceId: document.id,
    result: 'success',
    metadata: { visibility: document.visibility }
  });

  return { url: await getStorageAdapter().createDownloadUrl(document.storageKey) };
}

const acknowledgeSchema = z.object({
  documentId: z.uuid(),
  typedName: z.string().trim().min(1).max(200)
});

/**
 * Records that someone read and accepted a document.
 *
 * This is an internal acknowledgement, not a qualified electronic signature — see the comment
 * on the table. The typed name is checked against the employee's own name so an accidental
 * acceptance on a shared screen is caught, but that check is a usability guard, not proof of
 * identity; the session is what identifies the person.
 */
export async function acknowledgeHrDocument(input: z.input<typeof acknowledgeSchema>) {
  const caller = await requireActiveEmployee();
  const parsed = acknowledgeSchema.parse(input);

  const [document] = await db
    .select()
    .from(hrDocuments)
    .where(eq(hrDocuments.id, parsed.documentId))
    .limit(1);
  if (!document || document.archivedAt) throw new HrError('That document is not available');

  if (!canAcknowledgeHrDocument(caller, document)) {
    throw new HrError('That document is not yours to acknowledge');
  }
  if (!document.requiresAcknowledgement) {
    throw new HrError('That document does not need acknowledging');
  }

  // Either name is accepted. The Hub shows people their display name everywhere, so asking for
  // the account-of-record name and rejecting the name they see on screen would read as a broken
  // form. This check catches an accidental acceptance on a shared screen; it is not proof of
  // identity — the session is that.
  const typed = normaliseName(parsed.typedName);
  if (typed !== normaliseName(caller.name) && typed !== normaliseName(caller.displayName)) {
    throw new HrError(`Type your name exactly as it appears here: ${caller.displayName}`);
  }

  await db
    .insert(hrDocumentAcknowledgements)
    .values({
      documentId: document.id,
      employeeId: caller.id,
      typedName: parsed.typedName
    })
    // Acknowledging twice is a double click, not an error worth showing.
    .onConflictDoNothing({
      target: [hrDocumentAcknowledgements.documentId, hrDocumentAcknowledgements.employeeId]
    });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_document_acknowledged',
    resourceType: 'hr_document',
    resourceId: document.id,
    result: 'success',
    metadata: { title: document.title }
  });

  revalidatePath('/dashboard/hr/documents');
}

export async function archiveHrDocument(input: { documentId: string }) {
  const caller = await requireActiveEmployee();
  if (!canManageHrDocuments(caller)) throw new HrError('Only HR can archive documents');

  const [document] = await db
    .select()
    .from(hrDocuments)
    .where(eq(hrDocuments.id, input.documentId))
    .limit(1);
  if (!document) throw new HrError('That document is not available');

  // Archived rather than deleted, and the stored object is left in place: an acknowledgement
  // record that points at bytes nobody can retrieve any more proves nothing. Deleting for real
  // belongs with the retention policy still to be written (docs/data-classification.md).
  await db
    .update(hrDocuments)
    .set({ archivedAt: new Date() })
    .where(eq(hrDocuments.id, document.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'hr_document_archived',
    resourceType: 'hr_document',
    resourceId: document.id,
    result: 'success',
    metadata: { title: document.title }
  });

  revalidatePath('/dashboard/hr/documents');
}
