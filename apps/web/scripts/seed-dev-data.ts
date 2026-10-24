// Dev-only sample data so the dashboard, tasks, calendar, teams, and documents screens can be
// looked at and clicked through with real-looking numbers instead of an empty database. Every row
// this creates has isSeedData: true (or, for employees — see below — an @example.test address), so
// it's unmistakable as seed data at the database level — never confusable with a real the organisation client,
// task or employee (engineering rule 7 — never silently substitute fake data for real) — while
// still reading like plausible names on screen.
// Gated on NODE_ENV=development, same convention as lib/permissions/step-up.ts and
// lib/storage/index.ts — this must never be reachable once the app is actually deployed.
//
// Usage: npm run db:seed:dev [-- --email=someone@example.com]
// With no --email, seeds data onto the first active employee row found.
//
// Fake coworkers: employees.clerkUserId is a real, unique login and there is no isSeedData column
// on employees — fabricating teammates here is a deliberate, scoped exception, not a new general
// pattern (see the incident described in scripts/clean-test-data.ts about fake employee rows
// leaking into a live HR list). These use the same @example.test reserved-TLD marker that script
// already scans for, so `npm run clean:test-data -- --yes` removes them (and anything assigned to
// them) with no extra tooling needed. Their fake clerkUserId is never sent to Clerk's API by
// anything on read paths (avatars fall back to initials); it would only surface if an admin
// explicitly tried to ban/manage one of these rows from Settings > People & Access, which a
// throwaway dev account should not do.
import { eq, like } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  calendarEventAttendees,
  calendarEvents,
  clients,
  documentLinks,
  employees,
  enquiries,
  projectMilestones,
  projects,
  tasks
} from '../lib/db/schema';

if (process.env.NODE_ENV !== 'development') {
  throw new Error('seed-dev-data.ts only ever runs with NODE_ENV=development — refusing to run.');
}

const emailArg = process.argv.find((a) => a.startsWith('--email='))?.split('=')[1];

const COWORKERS = [
  { slug: 'james-walker', name: 'James Walker', workStatus: 'working' as const, minutesAgo: 245 },
  { slug: 'priya-patel', name: 'Priya Patel', workStatus: 'working' as const, minutesAgo: 190 },
  { slug: 'tom-hughes', name: 'Tom Hughes', workStatus: 'on_break' as const, minutesAgo: 15 },
  { slug: 'maya-rodriguez', name: 'Maya Rodriguez', workStatus: 'working' as const, minutesAgo: 320 },
  { slug: 'daniel-kim', name: 'Daniel Kim', workStatus: 'logged_off' as const, minutesAgo: 60 }
];

async function main() {
  const [employee] = emailArg
    ? await db.select().from(employees).where(eq(employees.email, emailArg)).limit(1)
    : await db.select().from(employees).where(eq(employees.status, 'active')).limit(1);

  if (!employee) {
    throw new Error(
      emailArg
        ? `No employee found with email ${emailArg}.`
        : 'No active employee found — sign in to the app once first so your employee row exists.'
    );
  }

  const team = employee.team ?? 'general';
  const now = new Date();
  const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60 * 1000);

  // Idempotent: wipe any previous seed run's rows before inserting fresh ones, identified by the
  // isSeedData flag (business rows) or the @example.test address (employees) rather than by name —
  // the names below are meant to read as plausible people/clients/tasks, not as an obvious "Test
  // ..." pattern. Cascades (clients -> projects -> milestones/document links, calendar events ->
  // attendees) handle most of the cleanup; tasks/events/enquiries not linked to a seeded client are
  // cleaned up directly by the same flag.
  await db.delete(clients).where(eq(clients.isSeedData, true));
  await db.delete(tasks).where(eq(tasks.isSeedData, true));
  await db.delete(calendarEvents).where(eq(calendarEvents.isSeedData, true));
  await db.delete(enquiries).where(eq(enquiries.isSeedData, true));
  await db.delete(employees).where(like(employees.email, '%@example.test'));

  const coworkers = await db
    .insert(employees)
    .values(
      COWORKERS.map((c) => ({
        clerkUserId: `seed_${c.slug.replace(/-/g, '_')}`,
        name: c.name,
        email: `${c.slug}@example.test`,
        role: 'EMPLOYEE' as const,
        team,
        status: 'active' as const,
        workStatus: c.workStatus,
        workStatusChangedAt: minutesAgo(c.minutesAgo)
      }))
    )
    .returning();
  const coworkerByName = (name: string) => coworkers.find((c) => c.name === name)!;

  const [clientWithDocs] = await db
    .insert(clients)
    .values({ name: 'Meridian Retail Group', team, serviceLine: 'Advisory', status: 'active', isSeedData: true })
    .returning();
  const [clientNoDocs] = await db
    .insert(clients)
    .values({ name: 'Harlow & Pryce Manufacturing', team, serviceLine: 'Assurance', status: 'active', isSeedData: true })
    .returning();
  const [clientThree] = await db
    .insert(clients)
    .values({ name: 'Castlebridge Properties', team, serviceLine: 'Tax', status: 'active', isSeedData: true })
    .returning();
  const [clientFour] = await db
    .insert(clients)
    .values({ name: 'Northgate Capital', team, serviceLine: 'Advisory', status: 'active', isSeedData: true })
    .returning();
  const [clientFive] = await db
    .insert(clients)
    .values({ name: 'Apex Healthcare', team, serviceLine: 'Assurance', status: 'active', isSeedData: true })
    .returning();

  // A real, always-reachable URL — the periodic reachability check
  // (lib/integrations/document-links/reachability.ts) actually HEAD/GETs every document link
  // in the table, including seeded ones, and flips the microsoft_365 integration to 'error' if
  // any come back broken. A placeholder path like example.com/fake-doc would 404 on every check
  // and permanently pollute the "Integration errors" dashboard card with fake noise.
  await db.insert(documentLinks).values({
    label: 'Engagement Letter',
    url: 'https://example.com',
    system: 'other',
    clientId: clientWithDocs.id,
    addedByEmployeeId: employee.id
  });

  const [projectOne] = await db
    .insert(projects)
    .values({ name: 'FY26 Advisory Review', clientId: clientWithDocs.id, team, status: 'active', isSeedData: true })
    .returning();
  const [projectTwo] = await db
    .insert(projects)
    .values({ name: 'Year-End Audit 2026', clientId: clientNoDocs.id, team, status: 'active', isSeedData: true })
    .returning();
  const [projectThree] = await db
    .insert(projects)
    .values({ name: 'Q4 Strategy Review', clientId: clientFour.id, team, status: 'active', isSeedData: true })
    .returning();

  await db.insert(projectMilestones).values([
    { projectId: projectOne.id, title: 'Draft advisory report', dueDate: days(3), isSeedData: true },
    { projectId: projectTwo.id, title: 'Audit fieldwork complete', dueDate: days(10), isSeedData: true },
    { projectId: projectOne.id, title: 'Client sign-off meeting', dueDate: days(-2), isSeedData: true },
    { projectId: projectThree.id, title: 'Data collection', dueDate: days(-6), completedAt: days(-6), isSeedData: true },
    { projectId: projectThree.id, title: 'Analysis phase', dueDate: days(9), isSeedData: true }
  ]);

  const jamesWalker = coworkerByName('James Walker');
  const priyaPatel = coworkerByName('Priya Patel');
  const tomHughes = coworkerByName('Tom Hughes');
  const mayaRodriguez = coworkerByName('Maya Rodriguez');

  await db.insert(tasks).values([
    { title: 'Reconcile Q3 management accounts', team, assigneeId: employee.id, clientId: clientWithDocs.id, projectId: projectOne.id, status: 'todo', priority: 'urgent', dueDate: days(-3), isSeedData: true },
    { title: 'Prepare VAT return draft', team, assigneeId: employee.id, clientId: clientWithDocs.id, projectId: projectOne.id, status: 'in_progress', priority: 'high', dueDate: days(-1), isSeedData: true },
    { title: 'Review fixed asset register', team, assigneeId: employee.id, clientId: clientNoDocs.id, projectId: projectTwo.id, status: 'todo', priority: 'high', dueDate: days(2), isSeedData: true },
    { title: 'Send audit confirmation letters', team, assigneeId: employee.id, clientId: clientNoDocs.id, projectId: projectTwo.id, status: 'in_progress', priority: 'medium', dueDate: days(4), isSeedData: true },
    { title: 'Follow up on missing invoices', team, assigneeId: employee.id, clientId: clientWithDocs.id, projectId: projectOne.id, status: 'blocked', priority: 'medium', dueDate: days(6), isSeedData: true },
    { title: 'Update engagement letter template', team, assigneeId: employee.id, status: 'todo', priority: 'low', dueDate: days(12), isSeedData: true },
    { title: 'Archive prior year working papers', team, assigneeId: employee.id, status: 'todo', priority: 'low', dueDate: null, isSeedData: true },
    { title: 'Chase outstanding client documents', team, assigneeId: employee.id, clientId: clientNoDocs.id, status: 'blocked', priority: 'urgent', dueDate: days(-5), isSeedData: true },
    { title: 'File confirmation statement', team, assigneeId: employee.id, projectId: projectTwo.id, status: 'done', priority: 'medium', dueDate: days(-4), isSeedData: true },
    { title: 'Close out onboarding checklist', team, assigneeId: employee.id, status: 'done', priority: 'low', dueDate: days(-10), isSeedData: true },
    // Coworker-assigned — populates project/client task lists with more than one person on them.
    { title: 'Review Q4 strategy deck', team, assigneeId: jamesWalker.id, clientId: clientFour.id, projectId: projectThree.id, status: 'in_progress', priority: 'high', dueDate: days(0), isSeedData: true },
    { title: 'Approve expense claims', team, assigneeId: employee.id, status: 'todo', priority: 'medium', dueDate: days(0), isSeedData: true },
    { title: 'Data mapping sign-off', team, assigneeId: priyaPatel.id, clientId: clientFour.id, projectId: projectThree.id, status: 'done', priority: 'medium', dueDate: days(-2), isSeedData: true },
    { title: 'Client health report — Apex Healthcare', team, assigneeId: tomHughes.id, clientId: clientFive.id, status: 'todo', priority: 'medium', dueDate: days(1), isSeedData: true },
    { title: 'Operations audit fieldwork', team, assigneeId: mayaRodriguez.id, clientId: clientThree.id, status: 'in_progress', priority: 'low', dueDate: days(7), isSeedData: true }
  ]);

  const meetingStart = days(2);
  const [eventOne] = await db
    .insert(calendarEvents)
    .values({ title: 'Client review call — Meridian Retail Group', team, createdByEmployeeId: employee.id, startAt: meetingStart, endAt: new Date(meetingStart.getTime() + 60 * 60 * 1000), isSeedData: true })
    .returning();
  const [eventTwo] = await db
    .insert(calendarEvents)
    .values({
      title: 'Audit planning meeting',
      team,
      createdByEmployeeId: employee.id,
      startAt: new Date(meetingStart.getTime() + 30 * 60 * 1000),
      endAt: new Date(meetingStart.getTime() + 90 * 60 * 1000),
      isSeedData: true
    })
    .returning();
  await db.insert(calendarEvents).values([
    { title: 'Tax planning session', team, createdByEmployeeId: employee.id, startAt: days(5), endAt: new Date(days(5).getTime() + 45 * 60 * 1000), isSeedData: true },
    { title: 'Team catch-up', team, createdByEmployeeId: employee.id, startAt: days(8), endAt: new Date(days(8).getTime() + 60 * 60 * 1000), isSeedData: true },
    { title: 'New client onboarding call', team, createdByEmployeeId: employee.id, startAt: days(9), endAt: new Date(days(9).getTime() + 60 * 60 * 1000), isSeedData: true }
  ]);
  await db.insert(calendarEventAttendees).values([
    { eventId: eventOne.id, employeeId: jamesWalker.id },
    { eventId: eventTwo.id, employeeId: priyaPatel.id }
  ]);

  await db.insert(enquiries).values([
    { contactName: 'Priya Desai', contactEmail: 'priya.desai@example.com', team, status: 'awaiting_response', createdBy: employee.id, isSeedData: true },
    { contactName: 'Tom Whitfield', contactEmail: 'tom.whitfield@example.com', team, status: 'awaiting_response', createdBy: employee.id, isSeedData: true }
  ]);

  console.log(`Seeded dev demo data onto ${employee.name} <${employee.email}> (team: ${team}).`);
  console.log(
    `${coworkers.length} coworkers, 5 clients, 3 projects, 5 milestones, 15 tasks, 5 calendar events, 2 enquiries.`
  );
  console.log('Run `npm run clean:test-data -- --yes` to remove the fake coworker accounts later.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
