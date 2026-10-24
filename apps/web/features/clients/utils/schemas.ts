import * as z from 'zod';

export const clientStatusValues = ['active', 'inactive'] as const;

export const createClientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  serviceLine: z.string().max(200).optional(),
  team: z.string().min(1).optional()
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  serviceLine: z.string().max(200).nullable().optional(),
  status: z.enum(clientStatusValues).optional(),
  team: z.string().min(1).optional()
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientStaffAssignmentSchema = z.object({
  employeeId: z.string().uuid()
});
export type ClientStaffAssignmentInput = z.infer<typeof clientStaffAssignmentSchema>;

export const addClientNoteSchema = z.object({
  body: z.string().min(1, 'Note cannot be empty').max(5000)
});
export type AddClientNoteInput = z.infer<typeof addClientNoteSchema>;

export const updateClientNoteSchema = z.object({
  body: z.string().min(1).max(5000)
});
export type UpdateClientNoteInput = z.infer<typeof updateClientNoteSchema>;
