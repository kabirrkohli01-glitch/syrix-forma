import * as z from 'zod';

export const setAutomationDaysSchema = z.object({
  days: z.coerce.number().positive().max(365)
});
export type SetAutomationDaysInput = z.infer<typeof setAutomationDaysSchema>;
