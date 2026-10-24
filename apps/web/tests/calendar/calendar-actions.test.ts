import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { calendarEventAttendees, calendarEvents, employees } from '@/lib/db/schema';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } = await import('@/features/calendar/actions');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIdAlphaEmployee = `test_${runId}_alpha_employee`;
const clerkIdAlphaEmployee2 = `test_${runId}_alpha_employee2`;
const clerkIdAlphaLead = `test_${runId}_alpha_lead`;
const clerkIdBetaEmployee = `test_${runId}_beta_employee`;

let alphaEmployeeId: string;
let alphaEmployee2Id: string;
let betaEmployeeId: string;
const createdEventIds: string[] = [];

beforeAll(async () => {
  const [alphaEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlphaEmployee,
      name: 'Alpha Employee',
      email: `${clerkIdAlphaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  const [alphaEmployee2] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdAlphaEmployee2,
      name: 'Alpha Employee 2',
      email: `${clerkIdAlphaEmployee2}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active'
    })
    .returning();
  await db.insert(employees).values({
    clerkUserId: clerkIdAlphaLead,
    name: 'Alpha Lead',
    email: `${clerkIdAlphaLead}@example.test`,
    role: 'TEAM_LEAD',
    team: 'alpha',
    status: 'active'
  });
  const [betaEmployee] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIdBetaEmployee,
      name: 'Beta Employee',
      email: `${clerkIdBetaEmployee}@example.test`,
      role: 'EMPLOYEE',
      team: 'beta',
      status: 'active'
    })
    .returning();

  alphaEmployeeId = alphaEmployee.id;
  alphaEmployee2Id = alphaEmployee2.id;
  betaEmployeeId = betaEmployee.id;
});

afterAll(async () => {
  for (const id of createdEventIds) {
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  }
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaEmployee2));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdAlphaLead));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkIdBetaEmployee));
});

const start = new Date('2026-02-02T10:00:00Z');
const end = new Date('2026-02-02T11:00:00Z');

describe('createCalendarEvent', () => {
  it('creates an event defaulting team to the caller\'s own, with attendees inserted atomically', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createCalendarEvent({
      title: 'Kickoff meeting',
      startAt: start,
      endAt: end,
      attendeeIds: [alphaEmployee2Id]
    });
    createdEventIds.push(created.id);

    expect(created.team).toBe('alpha');
    expect(created.createdByEmployeeId).toBe(alphaEmployeeId);

    const attendees = await db
      .select()
      .from(calendarEventAttendees)
      .where(eq(calendarEventAttendees.eventId, created.id));
    expect(attendees).toHaveLength(1);
    expect(attendees[0].employeeId).toBe(alphaEmployee2Id);
  });

  it('rejects end time before start time', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(
      createCalendarEvent({ title: 'Backwards', startAt: end, endAt: start })
    ).rejects.toThrow();
  });

  it('rejects an EMPLOYEE creating an event outside their own team', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    await expect(
      createCalendarEvent({ title: 'Wrong team', startAt: start, endAt: end, team: 'beta' })
    ).rejects.toThrow();
  });
});

describe('updateCalendarEvent / deleteCalendarEvent', () => {
  it('lets the creator edit and replace the attendee set, rejects an uninvolved teammate', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createCalendarEvent({
      title: 'Planning session',
      startAt: start,
      endAt: end,
      attendeeIds: [alphaEmployee2Id]
    });
    createdEventIds.push(created.id);

    const updated = await updateCalendarEvent(created.id, {
      title: 'Planning session (rescheduled)',
      attendeeIds: []
    });
    expect(updated.title).toBe('Planning session (rescheduled)');

    const attendeesAfter = await db
      .select()
      .from(calendarEventAttendees)
      .where(eq(calendarEventAttendees.eventId, created.id));
    expect(attendeesAfter).toHaveLength(0);

    // Beta is a different team and was never invited (attendees were just cleared) — no view or
    // edit access.
    mockAuth.mockResolvedValue({ userId: clerkIdBetaEmployee });
    await expect(updateCalendarEvent(created.id, { title: 'Hijacked' })).rejects.toThrow();
  });

  it('lets an invited attendee (not the creator) view/edit via involvement, even cross-team', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createCalendarEvent({
      title: 'Cross-team sync',
      startAt: start,
      endAt: end,
      attendeeIds: [betaEmployeeId]
    });
    createdEventIds.push(created.id);

    mockAuth.mockResolvedValue({ userId: clerkIdBetaEmployee });
    const updated = await updateCalendarEvent(created.id, { location: 'Room 4' });
    expect(updated.location).toBe('Room 4');
  });

  it('deletes an event, cascading its attendees', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createCalendarEvent({
      title: 'Deletable event',
      startAt: start,
      endAt: end,
      attendeeIds: [alphaEmployee2Id]
    });

    await deleteCalendarEvent(created.id);

    const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, created.id)).limit(1);
    expect(row).toBeUndefined();
    const attendees = await db
      .select()
      .from(calendarEventAttendees)
      .where(eq(calendarEventAttendees.eventId, created.id));
    expect(attendees).toHaveLength(0);
  });

  it('lets a TEAM_LEAD edit a same-team event they neither created nor were invited to', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIdAlphaEmployee });
    const created = await createCalendarEvent({ title: 'Team event', startAt: start, endAt: end });
    createdEventIds.push(created.id);

    mockAuth.mockResolvedValue({ userId: clerkIdAlphaLead });
    const updated = await updateCalendarEvent(created.id, { title: 'Team event (updated by lead)' });
    expect(updated.title).toBe('Team event (updated by lead)');
  });
});
