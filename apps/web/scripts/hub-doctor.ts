/**
 * Read-only snapshot of the state a running SYRIX Forma is actually in.
 *
 * Written because several "the app won't let me do anything" symptoms are configuration, not
 * code: an account without the role a feature is gated on, or a feature whose reference data
 * (leave types, expense categories) was never created, both present as a screen that refuses.
 * This answers which of the two it is without guessing.
 *
 *   npm run doctor
 */
import { count, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  employees,
  expenseCategories,
  hrDocuments,
  leaveAllowances,
  leaveRequests,
  leaveSettings,
  leaveTypes
} from '@/lib/db/schema';
import { isHrAdminRow } from '@/lib/db/hr-admin';

async function tableCount(label: string, table: Parameters<typeof db.select>[0] extends never ? never : any) {
  const [row] = await db.select({ total: count() }).from(table);
  return `${label}: ${row?.total ?? 0}`;
}

async function main() {
  console.log('--- accounts ---');
  const people = await db
    .select({
      name: employees.name,
      preferredName: employees.preferredName,
      email: employees.email,
      role: employees.role,
      status: employees.status,
      team: employees.team,
      managerId: employees.managerId,
      financeAccess: employees.financeAccess,
      hrAdmin: employees.hrAdmin
    })
    .from(employees)
    .orderBy(employees.createdAt);

  for (const p of people) {
    console.log(
      [
        p.status.padEnd(8),
        (p.role ?? 'NO ROLE').padEnd(15),
        (p.preferredName || p.name).padEnd(24),
        p.email.padEnd(32),
        `team=${p.team ?? '-'}`,
        `manager=${p.managerId ? 'set' : 'none'}`,
        `hrAdmin=${p.hrAdmin}`,
        `finance=${p.financeAccess}`
      ].join(' ')
    );
  }

  console.log('\n--- reference data every HR screen depends on ---');
  for (const [label, table] of [
    ['leave types', leaveTypes],
    ['leave settings rows', leaveSettings],
    ['leave allowances', leaveAllowances],
    ['leave requests', leaveRequests],
    ['expense categories', expenseCategories],
    ['HR documents', hrDocuments]
  ] as const) {
    try {
      console.log(await tableCount(label, table));
    } catch (error) {
      console.log(`${label}: table missing (${(error as Error).message.split('\n')[0]})`);
    }
  }

  console.log('\n--- roles the schema allows ---');
  const roles = await db.execute<{ enumlabel: string }>(
    sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'employee_role' order by e.enumsortorder`
  );
  console.log(roles.map((r) => r.enumlabel).join(', '));

  // isHrAdminRow, not a raw role comparison — HR administration is a role OR the hrAdmin
  // capability now, and a count that only checked the role would undercount anyone who reaches
  // HR through the capability instead (the common case since the ADMIN+hrAdmin fix).
  const [hrAdmins] = await db.select({ total: count() }).from(employees).where(isHrAdminRow);
  console.log(`\naccounts with HR administration (role or capability): ${hrAdmins?.total ?? 0}`);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
