import * as z from 'zod';

export const saveHostingerMailCredentialsSchema = z.object({
  apiToken: z.string().min(1, 'API token is required'),
  mailboxResourceId: z.string().min(1, 'Mailbox resource ID is required'),
  webhookToken: z.string().min(1, 'Webhook token is required'),
  defaultTeam: z.string().min(1, 'A default team is required for email-detected enquiries')
});
export type SaveHostingerMailCredentialsInput = z.infer<typeof saveHostingerMailCredentialsSchema>;
