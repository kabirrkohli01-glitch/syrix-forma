import * as z from 'zod';

export const workStatusValues = ['working', 'on_break', 'logged_off'] as const;

export const setWorkStatusSchema = z.object({
  status: z.enum(workStatusValues)
});
export type SetWorkStatusInput = z.infer<typeof setWorkStatusSchema>;
