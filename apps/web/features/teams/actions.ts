'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { setWorkStatusSchema, type SetWorkStatusInput } from './utils/schemas';

/**
 * Self-only — there is no target employee id in the input. Every role can set their own
 * work status; there is no separate permission tier the way there is for team/business data
 * (docs/permissions-matrix.md), since this never exposes or changes anything about anyone
 * else's record.
 */
export async function setWorkStatus(input: SetWorkStatusInput) {
  const caller = await requireActiveEmployee();
  const parsed = setWorkStatusSchema.parse(input);

  await db
    .update(employees)
    .set({ workStatus: parsed.status, workStatusChangedAt: new Date() })
    .where(eq(employees.id, caller.id));

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'work_status_changed',
    resourceType: 'employee',
    resourceId: caller.id,
    result: 'success',
    metadata: { status: parsed.status }
  });

  revalidatePath('/dashboard/teams');
}
