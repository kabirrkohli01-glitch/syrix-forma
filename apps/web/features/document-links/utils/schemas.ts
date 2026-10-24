import * as z from 'zod';

export const documentLinkSystemValues = ['sharepoint', 'onedrive', 'nas', 'other'] as const;

// Exactly one of clientId/projectId/taskId — a document link belongs to one parent, never more
// than one and never none (same constraint the table comment in lib/db/schema.ts documents).
// taskId added Phase 5, reusing document links as a task's "attachments".
export const addDocumentLinkSchema = z
  .object({
    label: z.string().min(1, 'Label is required').max(200),
    url: z.string().url('Enter a full URL, including https://'),
    system: z.enum(documentLinkSystemValues),
    clientId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional()
  })
  .refine((data) => [data.clientId, data.projectId, data.taskId].filter(Boolean).length === 1, {
    message: 'A document link must belong to exactly one client, project, or task'
  });
export type AddDocumentLinkInput = z.infer<typeof addDocumentLinkSchema>;
