import * as z from 'zod';

export const taskStatusValues = ['todo', 'in_progress', 'blocked', 'done'] as const;
export const taskPriorityValues = ['low', 'medium', 'high', 'urgent'] as const;
export const recurrenceFrequencyValues = ['daily', 'weekly', 'monthly'] as const;

// Null clears recurrence; undefined leaves it unchanged (updateTaskSchema only).
export const recurrenceRuleSchema = z.object({
  frequency: z.enum(recurrenceFrequencyValues),
  interval: z.number().int().min(1).max(365)
});
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  dueDate: z.coerce.date().optional(),
  team: z.string().min(1).optional(),
  assigneeId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  // Set when this task is a subtask created from a parent task's detail view — the parent's own
  // team/client/project are used as defaults unless overridden (features/tasks/actions.ts).
  parentTaskId: z.string().uuid().optional(),
  recurrenceRule: recurrenceRuleSchema.optional()
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(taskStatusValues).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  team: z.string().min(1).optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional()
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const assignTaskSchema = z.object({
  assigneeId: z.string().uuid().nullable()
});
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

export const addChecklistItemSchema = z.object({
  label: z.string().min(1, 'Label is required').max(300)
});
export type AddChecklistItemInput = z.infer<typeof addChecklistItemSchema>;

export const updateChecklistItemSchema = z.object({
  label: z.string().min(1).max(300).optional(),
  done: z.boolean().optional()
});
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

export const addTaskCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000)
});
export type AddTaskCommentInput = z.infer<typeof addTaskCommentSchema>;

export const updateTaskCommentSchema = z.object({
  body: z.string().min(1).max(5000)
});
export type UpdateTaskCommentInput = z.infer<typeof updateTaskCommentSchema>;

// Omitted employeeId means "watch this task myself".
export const addTaskWatcherSchema = z.object({
  employeeId: z.string().uuid().optional()
});
export type AddTaskWatcherInput = z.infer<typeof addTaskWatcherSchema>;

export const addTaskDependencySchema = z.object({
  dependsOnTaskId: z.string().uuid()
});
export type AddTaskDependencyInput = z.infer<typeof addTaskDependencySchema>;
