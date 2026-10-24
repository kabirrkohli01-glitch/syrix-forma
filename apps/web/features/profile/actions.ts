'use server';

import { auth, clerkClient } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';

const MAX_PREFERRED_NAME_LENGTH = 60;

// The caller's own preferred name only — never takes an employee id, for the same reason
// features/forma-ai/actions.ts doesn't: this changes what the Hub calls ONE person, and an action
// that could target anyone else's row would be a way to rename a colleague.
export async function updatePreferredName(rawName: string): Promise<{ displayName: string }> {
  const caller = await requireActiveEmployee();

  const trimmed = rawName.trim().slice(0, MAX_PREFERRED_NAME_LENGTH);
  const preferredName = trimmed || null;

  const [updated] = await db
    .update(employees)
    .set({ preferredName, updatedAt: new Date() })
    .where(eq(employees.id, caller.id))
    .returning({ name: employees.name, preferredName: employees.preferredName });

  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');

  return { displayName: updated?.preferredName?.trim() || updated?.name || caller.displayName };
}

// Self-service "log out everywhere" — revokes every other active Clerk session for the
// signed-in user, leaving the session making this request untouched. Distinct from
// disableEmployee() in features/access-control/actions.ts, which is an ADMIN offboarding
// another employee (bans the account outright).
export async function signOutOtherSessions() {
  const { userId, sessionId } = await auth();
  if (!userId) throw new Error('Not signed in');

  const client = await clerkClient();
  const { data: sessions } = await client.sessions.getSessionList({ userId, status: 'active' });

  await Promise.all(
    sessions.filter((session) => session.id !== sessionId).map((session) => client.sessions.revokeSession(session.id))
  );
}
