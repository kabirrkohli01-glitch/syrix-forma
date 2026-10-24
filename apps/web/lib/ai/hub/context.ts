/* Reading the Hub, as the person who asked.
 *
 * The architecture's rule (docs/forma-ai-architecture.md §6) is that effective
 * access is `grant ∩ employee permissions`, and this file is the second half of
 * that intersection. Every read below reuses the SAME scope conditions the
 * Hub's own screens use — `taskScopeCondition`, `calendarEventScopeCondition`
 * and the rest — rather than writing its own WHERE clause that happens to agree
 * with them today.
 *
 * That is the whole design. A second implementation of "which tasks can this
 * person see" would drift from the first the moment either changed, and the
 * drift would be silent and in the dangerous direction: the assistant would
 * quietly show a consultant a row the task list refuses them. Asking SYRIX AI is
 * not a way around a permission, and the way to make that true is to have no
 * second answer to the question.
 *
 * WHAT IS UNREACHABLE FROM HERE, AT ANY ROLE. The audit log, session records,
 * MFA secrets and security events are not queried by anything in this file and
 * must never be. `docs/data-classification.md` puts them at HIGHLY CONFIDENTIAL,
 * which §6 makes a hard ceiling rather than a permission — a SECURITY_ADMIN
 * asking the assistant still gets nothing, because the query does not exist.
 *
 * Nothing here writes. Writes go through the action broker and an approval card.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  calendarEventAttendees,
  calendarEvents,
  clients,
  employees,
  projects,
  tasks
} from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';
import { calendarEventScopeCondition } from '@/features/calendar/utils/scope';
import { clientScopeCondition } from '@/features/clients/utils/scope';
import { projectScopeCondition } from '@/features/projects/utils/scope';
import { taskScopeCondition } from '@/features/tasks/utils/scope';

/* A read returns rows for a prompt, not for a table. Small ceilings on purpose:
   the model reasons better over the fifteen tasks that matter than over two
   hundred, and a Hub read shares its prompt budget with retrieved sources. */
const LIMIT = { tasks: 25, events: 25, clients: 25, projects: 25, people: 60 } as const;

export interface HubReading {
  /** What was read, in the assistant's own words. Shown in the thinking panel. */
  label: string;
  /** Rendered rows the model reads. Plain text — never markup. */
  text: string;
  /** How many rows the caller was permitted to see. Zero is a real answer. */
  rows: number;
}

function orNothing(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}

function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : 'no date';
}

function when(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

/* ---------- who works here ---------- */

/**
 * The staff directory, scoped.
 *
 * This is the read behind "who works here" and "who is on my team", and it is
 * the reason the assistant does not need a hardcoded staff list: a name typed
 * into a source file is wrong the first time somebody joins, and wrong silently.
 *
 * Only ACTIVE employees. A pending row is somebody Clerk has seen and an admin
 * has not yet placed, and a disabled one is somebody who has left — listing
 * either as a colleague is wrong in a way people notice.
 */
export async function readTeam(caller: ActiveEmployee, options: { team?: string } = {}): Promise<HubReading> {
  const scope = scopeForBusinessData(caller.role);

  /* SECURITY_ADMIN has no business-data scope at all. They still get their own
     record — everyone can see themselves — rather than an empty list that reads
     as though the directory were broken. */
  if (scope === 'none' || scope === 'own') {
    return {
      label: 'your own record',
      text: `${caller.name} — ${caller.role}${caller.team ? `, ${caller.team} team` : ''} (${caller.email})`,
      rows: 1
    };
  }

  const restrictToOwnTeam = scope === 'team';
  const wanted = options.team?.trim();

  const conditions: SQL[] = [eq(employees.status, 'active')];
  if (restrictToOwnTeam) {
    /* A TEAM_LEAD sees their own team. With no team set they see only
       themselves, which the query expresses rather than special-casing. */
    conditions.push(caller.team ? eq(employees.team, caller.team) : eq(employees.id, caller.id));
  } else if (wanted) {
    conditions.push(ilike(employees.team, wanted));
  }

  const rows = await db
    .select({ name: employeeDisplayName, email: employees.email, role: employees.role, team: employees.team })
    .from(employees)
    .where(and(...conditions))
    .orderBy(asc(employees.team), asc(employeeDisplayName))
    .limit(LIMIT.people);

  if (!rows.length) {
    return { label: 'the staff directory', text: 'No active employees matched.', rows: 0 };
  }

  const text = rows
    .map((row) => `${row.name} — ${row.role ?? 'no role set'}${row.team ? `, ${row.team} team` : ''} (${row.email})`)
    .join('\n');

  return {
    label: restrictToOwnTeam ? `the ${caller.team} team (${rows.length})` : `the staff directory (${rows.length})`,
    text,
    rows: rows.length
  };
}

/* ---------- tasks ---------- */

export async function readTasks(
  caller: ActiveEmployee,
  options: { mineOnly?: boolean; overdueOnly?: boolean; search?: string } = {}
): Promise<HubReading> {
  const scope = taskScopeCondition(caller);

  const conditions: (SQL | undefined)[] = [scope, isNull(tasks.archivedAt)];
  if (options.mineOnly) conditions.push(eq(tasks.assigneeId, caller.id));
  if (options.overdueOnly) conditions.push(and(lte(tasks.dueDate, new Date()), ne(tasks.status, 'done')));
  if (options.search) conditions.push(ilike(tasks.title, `%${options.search}%`));

  const rows = await db
    .select({
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      team: tasks.team,
      assignee: employeeDisplayName,
      client: clients.name
    })
    .from(tasks)
    .leftJoin(employees, eq(tasks.assigneeId, employees.id))
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(and(...conditions.filter(Boolean as unknown as (value: SQL | undefined) => value is SQL)))
    /* Undated tasks last rather than first: a null due date sorts before every
       real one ascending, which buries the overdue work the question was about. */
    .orderBy(asc(tasks.dueDate), desc(tasks.priority))
    .limit(LIMIT.tasks);

  if (!rows.length) {
    return {
      label: options.mineOnly ? 'your tasks' : 'tasks',
      text: 'No tasks matched, within what you are permitted to see.',
      rows: 0
    };
  }

  const text = rows
    .map((row) =>
      orNothing(
        row.title,
        `status ${row.status}`,
        `priority ${row.priority}`,
        `due ${day(row.dueDate)}`,
        row.assignee ? `assigned to ${row.assignee}` : 'unassigned',
        row.client ? `client ${row.client}` : null
      )
    )
    .join('\n');

  return { label: `${rows.length} task(s)`, text, rows: rows.length };
}

/* ---------- calendar ---------- */

export async function readCalendar(
  caller: ActiveEmployee,
  options: { fromDays?: number; days?: number } = {}
): Promise<HubReading> {
  const scope = calendarEventScopeCondition(caller);

  const from = new Date();
  from.setDate(from.getDate() + (options.fromDays ?? 0));
  from.setHours(0, 0, 0, 0);

  const until = new Date(from);
  until.setDate(until.getDate() + (options.days ?? 14));

  const rows = await db
    .select({
      title: calendarEvents.title,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      location: calendarEvents.location,
      team: calendarEvents.team,
      client: clients.name
    })
    .from(calendarEvents)
    .leftJoin(clients, eq(calendarEvents.clientId, clients.id))
    .where(
      and(
        ...[scope, gte(calendarEvents.startAt, from), lte(calendarEvents.startAt, until)].filter(
          Boolean as unknown as (value: SQL | undefined) => value is SQL
        )
      )
    )
    .orderBy(asc(calendarEvents.startAt))
    .limit(LIMIT.events);

  if (!rows.length) {
    return {
      label: `the next ${options.days ?? 14} days`,
      text: `Nothing is in the calendar between ${day(from)} and ${day(until)}, within what you are permitted to see.`,
      rows: 0
    };
  }

  const text = rows
    .map((row) =>
      orNothing(
        row.title,
        row.allDay ? `all day ${day(row.startAt)}` : `${when(row.startAt)} to ${when(row.endAt)}`,
        row.location ? `at ${row.location}` : null,
        row.client ? `client ${row.client}` : null,
        `${row.team} team`
      )
    )
    .join('\n');

  return { label: `${rows.length} event(s)`, text, rows: rows.length };
}

/* ---------- clients and projects ---------- */

export async function readClients(caller: ActiveEmployee, options: { search?: string } = {}): Promise<HubReading> {
  const scope = clientScopeCondition(caller);

  const conditions: (SQL | undefined)[] = [scope];
  if (options.search) conditions.push(ilike(clients.name, `%${options.search}%`));

  const rows = await db
    .select({
      name: clients.name,
      serviceLine: clients.serviceLine,
      status: clients.status,
      team: clients.team
    })
    .from(clients)
    .where(and(...conditions.filter(Boolean as unknown as (value: SQL | undefined) => value is SQL)))
    .orderBy(asc(clients.name))
    .limit(LIMIT.clients);

  if (!rows.length) {
    return { label: 'clients', text: 'No clients matched, within what you are permitted to see.', rows: 0 };
  }

  const text = rows
    .map((row) => orNothing(row.name, row.serviceLine, row.status, `${row.team} team`))
    .join('\n');

  return { label: `${rows.length} client(s)`, text, rows: rows.length };
}

export async function readProjects(caller: ActiveEmployee, options: { search?: string } = {}): Promise<HubReading> {
  const scope = projectScopeCondition(caller);

  const conditions: (SQL | undefined)[] = [scope];
  if (options.search) conditions.push(ilike(projects.name, `%${options.search}%`));

  const rows = await db
    .select({
      name: projects.name,
      status: projects.status,
      team: projects.team,
      client: clients.name
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...conditions.filter(Boolean as unknown as (value: SQL | undefined) => value is SQL)))
    .orderBy(asc(projects.name))
    .limit(LIMIT.projects);

  if (!rows.length) {
    return { label: 'projects', text: 'No projects matched, within what you are permitted to see.', rows: 0 };
  }

  const text = rows
    .map((row) => orNothing(row.name, row.client ? `for ${row.client}` : null, row.status, `${row.team} team`))
    .join('\n');

  return { label: `${rows.length} project(s)`, text, rows: rows.length };
}

/* ---------- the standing brief ---------- */

/**
 * A short factual summary of the caller's own workload.
 *
 * Counts only, and cheap enough to attach to any Hub-shaped turn. It exists so
 * "what should I be looking at" does not need three separate reads before the
 * assistant has anything to say.
 */
export async function readMyStanding(caller: ActiveEmployee): Promise<HubReading> {
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const open = and(eq(tasks.assigneeId, caller.id), isNull(tasks.archivedAt), ne(tasks.status, 'done'));

  const [[openCount], [overdueCount], [dueSoonCount]] = await Promise.all([
    db.select({ total: count() }).from(tasks).where(open),
    db.select({ total: count() }).from(tasks).where(and(open, lte(tasks.dueDate, now))),
    db.select({ total: count() }).from(tasks).where(and(open, gte(tasks.dueDate, now), lte(tasks.dueDate, weekEnd)))
  ]);

  const events = await db
    .select({ total: count() })
    .from(calendarEvents)
    .where(
      and(
        gte(calendarEvents.startAt, now),
        lte(calendarEvents.startAt, weekEnd),
        or(
          eq(calendarEvents.createdByEmployeeId, caller.id),
          inArray(
            calendarEvents.id,
            db
              .select({ id: calendarEventAttendees.eventId })
              .from(calendarEventAttendees)
              .where(eq(calendarEventAttendees.employeeId, caller.id))
          )
        )
      )
    );

  const text = [
    `Open tasks assigned to ${caller.name}: ${openCount?.total ?? 0}`,
    `Of those, overdue: ${overdueCount?.total ?? 0}`,
    `Due in the next 7 days: ${dueSoonCount?.total ?? 0}`,
    `Calendar events they are involved in over the next 7 days: ${events[0]?.total ?? 0}`
  ].join('\n');

  return { label: 'your workload', text, rows: 1 };
}
