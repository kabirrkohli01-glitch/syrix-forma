import * as z from 'zod';

const baseEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(300).optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  allDay: z.boolean().optional(),
  team: z.string().min(1).optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  attendeeIds: z.array(z.string().uuid()).max(200).optional()
});

// Exactly one of clientId/projectId — mirrors document_links' own constraint. Both omitted is
// fine (a plain internal meeting with no client/project context).
export const createCalendarEventSchema = baseEventSchema
  .refine((data) => data.endAt >= data.startAt, {
    message: 'End time must be after the start time',
    path: ['endAt']
  })
  .refine((data) => !(data.clientId && data.projectId), {
    message: 'An event can link to a client or a project, not both',
    path: ['projectId']
  });
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

export const updateCalendarEventSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    allDay: z.boolean().optional(),
    team: z.string().min(1).optional(),
    clientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    attendeeIds: z.array(z.string().uuid()).max(200).optional()
  })
  .refine((data) => !(data.startAt && data.endAt) || data.endAt >= data.startAt, {
    message: 'End time must be after the start time',
    path: ['endAt']
  })
  .refine((data) => !(data.clientId && data.projectId), {
    message: 'An event can link to a client or a project, not both',
    path: ['projectId']
  });
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;
