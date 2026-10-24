'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { calendarEventAttendees, calendarEvents } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { teamForNewRecord } from '@/lib/permissions/default-team';
import { canEditCalendarEvent, type CalendarEventTarget } from '@/lib/permissions/calendar-access';
import {
  createCalendarEventSchema,
  updateCalendarEventSchema,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput
} from './utils/schemas';

async function getEventOrThrow(eventId: string) {
  const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).limit(1);
  if (!event) throw new Error('Event not found');
  return event;
}

async function isCallerInvolved(eventId: string, event: { createdByEmployeeId: string | null }, employeeId: string) {
  if (event.createdByEmployeeId === employeeId) return true;
  const [row] = await db
    .select({ id: calendarEventAttendees.id })
    .from(calendarEventAttendees)
    .where(and(eq(calendarEventAttendees.eventId, eventId), eq(calendarEventAttendees.employeeId, employeeId)))
    .limit(1);
  return !!row;
}

export async function createCalendarEvent(input: CreateCalendarEventInput) {
  const caller = await requireActiveEmployee();
  const parsed = createCalendarEventSchema.parse(input);

  let team = teamForNewRecord(caller.team);
  if (parsed.team && parsed.team !== team) {
    if (caller.role !== 'ADMIN') {
      throw new Error('Only an ADMIN can create an event outside your own team');
    }
    team = parsed.team;
  }

  const created = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(calendarEvents)
      .values({
        title: parsed.title,
        description: parsed.description ?? null,
        location: parsed.location ?? null,
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        allDay: parsed.allDay ?? false,
        team,
        createdByEmployeeId: caller.id,
        clientId: parsed.clientId ?? null,
        projectId: parsed.projectId ?? null
      })
      .returning();

    if (parsed.attendeeIds && parsed.attendeeIds.length > 0) {
      await tx
        .insert(calendarEventAttendees)
        .values(parsed.attendeeIds.map((employeeId) => ({ eventId: event.id, employeeId })))
        .onConflictDoNothing();
    }

    return event;
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'calendar_event_created',
    resourceType: 'calendar_event',
    resourceId: created.id,
    result: 'success',
    metadata: { team, attendeeCount: parsed.attendeeIds?.length ?? 0 }
  });

  revalidatePath('/dashboard/calendar');
  return created;
}

export async function updateCalendarEvent(eventId: string, input: UpdateCalendarEventInput) {
  const caller = await requireActiveEmployee();
  const parsed = updateCalendarEventSchema.parse(input);
  const event = await getEventOrThrow(eventId);
  const target: CalendarEventTarget = { id: event.id, team: event.team };
  const involved = await isCallerInvolved(eventId, event, caller.id);

  if (!canEditCalendarEvent(caller, target, involved)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'calendar_event_updated',
      resourceType: 'calendar_event',
      resourceId: eventId,
      result: 'denied'
    });
    throw new Error('Not permitted to edit this event');
  }

  if (parsed.team && parsed.team !== event.team && caller.role !== 'ADMIN') {
    throw new Error("Only an ADMIN can change an event's team");
  }

  const { attendeeIds, ...fields } = parsed;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calendarEvents)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(calendarEvents.id, eventId))
      .returning();

    if (attendeeIds) {
      await tx.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId));
      if (attendeeIds.length > 0) {
        await tx
          .insert(calendarEventAttendees)
          .values(attendeeIds.map((employeeId) => ({ eventId, employeeId })))
          .onConflictDoNothing();
      }
    }

    return row;
  });

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'calendar_event_updated',
    resourceType: 'calendar_event',
    resourceId: eventId,
    result: 'success',
    metadata: { fields: Object.keys(parsed) }
  });

  revalidatePath('/dashboard/calendar');
  return updated;
}

export async function deleteCalendarEvent(eventId: string) {
  const caller = await requireActiveEmployee();
  const event = await getEventOrThrow(eventId);
  const target: CalendarEventTarget = { id: event.id, team: event.team };
  const involved = await isCallerInvolved(eventId, event, caller.id);

  if (!canEditCalendarEvent(caller, target, involved)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'calendar_event_deleted',
      resourceType: 'calendar_event',
      resourceId: eventId,
      result: 'denied'
    });
    throw new Error('Not permitted to delete this event');
  }

  await db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'calendar_event_deleted',
    resourceType: 'calendar_event',
    resourceId: eventId,
    result: 'success',
    metadata: { title: event.title }
  });

  revalidatePath('/dashboard/calendar');
}
