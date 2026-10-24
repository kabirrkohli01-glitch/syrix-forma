import * as z from 'zod';

export const conversationTypeValues = ['dm', 'group'] as const;

// Allow-list, not a deny-list — anything not explicitly a document/image type a reviewer would
// reasonably open in Chat is rejected, including executables and scripts. Enforced here (used by
// both requestAttachmentUploadSchema below and the confirm step in attachments-actions.ts), never
// only on the client.
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
] as const;

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

export const createConversationSchema = z.object({
  type: z.enum(conversationTypeValues),
  participantEmployeeIds: z.array(z.string().uuid()).min(1),
  name: z.string().min(1).max(200).optional()
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1, 'Message cannot be empty').max(10000)
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const requestAttachmentUploadSchema = z.object({
  conversationId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_ATTACHMENT_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_SIZE_BYTES)
});
export type RequestAttachmentUploadInput = z.infer<typeof requestAttachmentUploadSchema>;

export const confirmAttachmentSchema = z.object({
  messageId: z.string().uuid(),
  storageKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_ATTACHMENT_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_SIZE_BYTES)
});
export type ConfirmAttachmentInput = z.infer<typeof confirmAttachmentSchema>;
