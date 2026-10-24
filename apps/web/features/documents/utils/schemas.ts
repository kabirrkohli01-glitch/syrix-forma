import { z } from 'zod';

/**
 * File types the Documents library accepts.
 *
 * An allowlist rather than a blocklist, and the same shape HR documents already use: the MIME
 * type arrives from the browser and is a claim, not evidence, so the narrower the accepted set
 * the less there is to go wrong when it lies. Anything outside it is exactly the case that
 * `documentLinks` covers — point at the file where it lives instead of copying it in here.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

/** 25 MB, matching HR documents and Team Chat attachments — one number, not three. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** What each accepted type is called in a sentence, for the "what can I upload" hint. */
export const ACCEPTED_DOCUMENT_LABEL = 'PDF, Word, Excel, PowerPoint, text, CSV or image, up to 25 MB';

const attachment = {
  clientId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  taskId: z.uuid().optional()
};

/** At most one parent. A document belonging to two records has no single answer for who can see it. */
function atMostOneParent(value: { clientId?: string; projectId?: string; taskId?: string }) {
  return [value.clientId, value.projectId, value.taskId].filter(Boolean).length <= 1;
}

export const requestDocumentUploadSchema = z
  .object({
    title: z.string().trim().min(1, 'Give it a name').max(200),
    description: z.string().trim().max(2000).optional(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
    /** Omitted means the uploader's own team. */
    team: z.string().trim().min(1).max(100).optional(),
    ...attachment
  })
  .refine(atMostOneParent, {
    message: 'A document can belong to a client, a project or a task — not more than one',
    path: ['clientId']
  });

export type RequestDocumentUploadInput = z.input<typeof requestDocumentUploadSchema>;

export const updateDocumentSchema = z.object({
  documentId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional()
});

export type UpdateDocumentInput = z.input<typeof updateDocumentSchema>;
