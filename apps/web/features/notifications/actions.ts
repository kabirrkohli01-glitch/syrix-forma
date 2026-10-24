'use server';

/**
 * Reading and clearing one's own notifications.
 *
 * Several features have written to the `notifications` table since Phase 2 — a task assigned, an
 * automation failing, a follow-up falling due — and nothing ever read it back, so every one of
 * those notices was written to a screen that did not exist. That is what this and the bell in the
 * header exist to fix.
 *
 * There is no permission predicate here and there should not be: a notification belongs to
 * exactly one employee, no role widens that, and every statement below is scoped by the caller's
 * own id taken from the session. The `and(...)` on the update is the whole access control — an id
 * from the client picks which of *your* notifications is marked, never whose.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { listNotifications, type NotificationRow } from './utils/queries';

export async function getMyNotifications(): Promise<NotificationRow[]> {
  const caller = await requireActiveEmployee();
  return listNotifications(caller.id);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const caller = await requireActiveEmployee();

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.id, notificationId), eq(notifications.employeeId, caller.id))
    );

  revalidatePath('/dashboard', 'layout');
}

export async function markAllNotificationsRead(): Promise<void> {
  const caller = await requireActiveEmployee();

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.employeeId, caller.id), isNull(notifications.readAt)));

  revalidatePath('/dashboard', 'layout');
}
