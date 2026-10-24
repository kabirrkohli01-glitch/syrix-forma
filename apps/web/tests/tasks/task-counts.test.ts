import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, tasks } from '@/lib/db/schema';
import { countOverdueTasksForEmployee } from '@/features/tasks/utils/counts';

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkId = `test_${runId}_employee`;

let employeeId: string;

beforeAll(async () => {
  const [employee] = await db
    .insert(employees)
    .values({ clerkUserId: clerkId, name: 'Counts Employee', email: `${clerkId}@example.test`, role: 'EMPLOYEE', team: 'alpha', status: 'active' })
    .returning();
  employeeId = employee.id;

  await db.insert(tasks).values([
    { title: `Overdue open ${runId}`, team: 'alpha', assigneeId: employeeId, status: 'todo', priority: 'high', dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    { title: `Overdue but done ${runId}`, team: 'alpha', assigneeId: employeeId, status: 'done', priority: 'high', dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    { title: `Not due yet ${runId}`, team: 'alpha', assigneeId: employeeId, status: 'todo', priority: 'low', dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
    { title: `Archived overdue ${runId}`, team: 'alpha', assigneeId: employeeId, status: 'todo', priority: 'low', dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), archivedAt: new Date() }
  ]);
});

afterAll(async () => {
  await db.delete(tasks).where(eq(tasks.assigneeId, employeeId));
  await db.delete(employees).where(eq(employees.clerkUserId, clerkId));
});

describe('countOverdueTasksForEmployee', () => {
  it('counts only open, non-archived, past-due tasks assigned to the employee', async () => {
    await expect(countOverdueTasksForEmployee(employeeId)).resolves.toBe(1);
  });

  it('returns 0 for an employee with no tasks', async () => {
    await expect(countOverdueTasksForEmployee('00000000-0000-0000-0000-000000000000')).resolves.toBe(0);
  });
});
