import * as z from 'zod';

export const projectStatusValues = ['active', 'on_hold', 'completed', 'cancelled'] as const;

export const createProjectSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(200),
  team: z.string().min(1).optional()
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(projectStatusValues).optional(),
  team: z.string().min(1).optional()
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectStaffAssignmentSchema = z.object({
  employeeId: z.string().uuid()
});
export type ProjectStaffAssignmentInput = z.infer<typeof projectStaffAssignmentSchema>;

export const addMilestoneSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  dueDate: z.coerce.date().optional()
});
export type AddMilestoneInput = z.infer<typeof addMilestoneSchema>;
