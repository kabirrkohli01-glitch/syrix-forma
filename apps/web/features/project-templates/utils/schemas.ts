import * as z from 'zod';
import { taskPriorityValues } from '@/features/tasks/utils/schemas';

export const createProjectTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  serviceLine: z.string().max(200).optional()
});
export type CreateProjectTemplateInput = z.infer<typeof createProjectTemplateSchema>;

export const addTemplateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  relativeDueDays: z.coerce.number().int().min(0).max(3650).optional()
});
export type AddTemplateTaskInput = z.infer<typeof addTemplateTaskSchema>;

export const addTemplateMilestoneSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  relativeDueDays: z.coerce.number().int().min(0).max(3650).optional()
});
export type AddTemplateMilestoneInput = z.infer<typeof addTemplateMilestoneSchema>;

export const createProjectFromTemplateSchema = z.object({
  templateId: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(200),
  team: z.string().min(1).optional(),
  startDate: z.coerce.date()
});
export type CreateProjectFromTemplateInput = z.infer<typeof createProjectFromTemplateSchema>;
