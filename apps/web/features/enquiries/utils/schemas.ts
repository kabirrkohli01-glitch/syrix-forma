import * as z from 'zod';

export const enquiryStatusValues = [
  'new',
  'in_progress',
  'awaiting_response',
  'responded',
  'closed'
] as const;

export const createEnquirySchema = z.object({
  contactName: z.string().min(1, 'Contact name is required').max(200),
  contactEmail: z.string().email('A valid email is required'),
  message: z.string().max(5000).optional(),
  team: z.string().min(1).optional(),
  clientId: z.string().uuid().optional()
});
export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;

export const setEnquiryStatusSchema = z.object({
  status: z.enum(enquiryStatusValues)
});
export type SetEnquiryStatusInput = z.infer<typeof setEnquiryStatusSchema>;

export const replyToEnquirySchema = z.object({
  text: z.string().min(1, 'Message body is required').max(20_000)
});
export type ReplyToEnquiryInput = z.infer<typeof replyToEnquirySchema>;
