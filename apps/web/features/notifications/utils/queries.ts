import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * How many unread notifications this employee has.
 *
 * Every query in this file is scoped by `employeeId` in its WHERE clause and takes that id from
 * the resolved caller, never from an argument a client supplied — a notification is addressed to
 * exactly one person and there is no role that widens that.
 */
export async function countUnreadNotifications(employeeId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.employeeId, employeeId), isNull(notifications.readAt)));
  return rows.length;
}

export async function listNotifications(
  employeeId: string,
  limit = 20
): Promise<NotificationRow[]> {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt
    })
    .from(notifications)
    .where(eq(notifications.employeeId, employeeId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
