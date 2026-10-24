/**
 * Removes rows left behind by a test run that did not finish.
 *
 *   npm run clean:test-data          # report only
 *   npm run clean:test-data -- --yes # actually delete
 *
 * Every database test in this repo creates its fixtures with a unique run tag and deletes them in
 * `afterAll`. When the worker process dies mid-run — which it has, under parallel load on Windows
 * — that cleanup never happens, and the rows stay. They then show up as people in the staff
 * directory and tasks on the board, which is how six accounts called
 * "Alpha Zephyrine1788965863960_u576bm4xj4h" ended up in a live HR list.
 *
 * **What identifies a test row is the employee's `@example.test` address**, a reserved TLD
 * (RFC 2606) that can never be a real one. Seed data is deliberately NOT touched: it is flagged
 * `isSeedData` and exists so the dashboard has something to show.
 *
 * Business records are only removed when they are attached to one of those accounts, and that
 * link is read before the accounts go — not guessed from a name afterwards.
 */
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { clientStaff, clients, employees, projectStaff, projects, tasks } from '@/lib/db/schema';

async function main() {
  const apply = process.argv.includes('--yes');

  const testAccounts = await db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .where(like(employees.email, '%@example.test'));

  if (testAccounts.length === 0) {
    console.log('No leftover test accounts. Nothing to do.');
    process.exit(0);
  }

  const ids = testAccounts.map((account) => account.id);

  // Read what they are attached to before deleting them: tasks.assignee_id is `set null` on
  // delete, so afterwards these would be unattributable rows with test names and no way left to
  // tell what they belonged to.
  const [assignedTasks, staffedClients, staffedProjects] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.assigneeId, ids)),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .innerJoin(clientStaff, eq(clientStaff.clientId, clients.id))
      .where(inArray(clientStaff.employeeId, ids)),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .innerJoin(projectStaff, eq(projectStaff.projectId, projects.id))
      .where(inArray(projectStaff.employeeId, ids))
  ]);

  console.log(`${testAccounts.length} leftover test account${testAccounts.length === 1 ? '' : 's'}:`);
  for (const account of testAccounts) console.log(`  ${account.name} <${account.email}>`);

  const report = (label: string, rows: { name?: string; title?: string }[]) => {
    if (rows.length === 0) return;
    console.log(`\n${rows.length} ${label} attached to them:`);
    for (const row of rows) console.log(`  ${row.name ?? row.title}`);
  };
  report('task(s)', assignedTasks);
  report('client(s)', staffedClients);
  report('project(s)', staffedProjects);

  if (!apply) {
    console.log('\nReport only. Re-run with --yes to delete.');
    process.exit(0);
  }

  // Projects before clients (a project references its client), then the accounts last so the
  // links above still resolve while the business rows are being removed.
  if (assignedTasks.length > 0) {
    await db.delete(tasks).where(inArray(tasks.id, assignedTasks.map((row) => row.id)));
  }
  if (staffedProjects.length > 0) {
    await db.delete(projects).where(inArray(projects.id, staffedProjects.map((row) => row.id)));
  }
  if (staffedClients.length > 0) {
    await db.delete(clients).where(inArray(clients.id, staffedClients.map((row) => row.id)));
  }
  await db.delete(employees).where(inArray(employees.id, ids));

  console.log(
    `\nRemoved ${testAccounts.length} account(s), ${assignedTasks.length} task(s), ` +
      `${staffedProjects.length} project(s), ${staffedClients.length} client(s).`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
