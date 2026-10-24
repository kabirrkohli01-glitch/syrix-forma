import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';

export type CreateNotificationInput = {
  employeeId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
};

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await db.insert(notifications).values({
    employeeId: input.employeeId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null
  });
}
