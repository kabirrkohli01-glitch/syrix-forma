import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';

// Same "assigned to me, not done, past due" definition the dashboard's Overdue card uses
// (app/dashboard/page.tsx) — a lean COUNT rather than fetching full rows, since this only
// needs to back a sidebar nav badge.
export async function countOverdueTasksForEmployee(employeeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.assigneeId, employeeId),
        ne(tasks.status, 'done'),
        isNull(tasks.archivedAt),
        lt(tasks.dueDate, new Date())
      )
    );
  return row?.count ?? 0;
}
