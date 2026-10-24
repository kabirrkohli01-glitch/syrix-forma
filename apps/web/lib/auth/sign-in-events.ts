/**
 * Recording who reached the Hub, from where, and telling an administrator when that is worth
 * knowing.
 *
 * Runs on the first request of every browser session — including sessions that the gate is about
 * to turn away. A request that never got in is the one most worth recording: an approved
 * employee signing in is routine, and a stranger who found the sign-up page is the event an
 * administrator actually needs to see.
 *
 * Nothing here can refuse a request or change what the caller may do. It observes and reports.
 * Every failure path swallows its error, because a page must not fail to render because an alert
 * could not be sent — the access decision has already been made correctly by the time this runs.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/lib/db/client';
import { resolveDisplayName } from '@/lib/db/display-name';
import { employees, signInEvents } from '@/lib/db/schema';
import { sendEmail } from '@/lib/notifications/email';
import { createNotification } from '@/lib/notifications/in-app';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { currentDeviceId } from './device-cookie';

type EmployeeRow = typeof employees.$inferSelect;

/**
 * The caller's address as the edge saw it.
 *
 * `x-forwarded-for` is a client-settable header everywhere it is not overwritten by a trusted
 * proxy, so the CDN's own header is preferred where one is present. This value is displayed to a
 * human and never compared against anything, which is what makes trusting it acceptable here and
 * would not if it gated access.
 */
function requestOrigin(headerList: Headers) {
  const forwardedFor = headerList.get('x-forwarded-for');
  return {
    ipAddress:
      headerList.get('cf-connecting-ip') ??
      headerList.get('x-real-ip') ??
      forwardedFor?.split(',')[0]?.trim() ??
      null,
    country: headerList.get('cf-ipcountry'),
    userAgent: headerList.get('user-agent')
  };
}

/** A user agent string reduced to the part a person reading an alert can act on. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const platform = /Windows/i.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown platform';

  // Order matters: every one of these ships a user agent that also contains "Chrome" or
  // "Safari", so the more specific names have to be tested first or everything reads as Chrome.
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Unknown browser';

  return `${browser} on ${platform}`;
}

async function activeAdmins() {
  return db
    .select({ id: employees.id, email: employees.email })
    .from(employees)
    .where(and(eq(employees.role, 'ADMIN'), eq(employees.status, 'active')));
}

/**
 * Tells every administrator something happened, in the app and by email.
 *
 * Both, deliberately. An in-app notification is only seen by someone already signed in, and the
 * whole point of an access request is that it arrives while nobody is looking at the Hub. Email
 * is the channel that reaches a phone.
 */
async function alertAdmins(input: {
  type: string;
  title: string;
  body: string;
  link: string;
  /** Who the alert is about. The limit below is per person, never global. */
  subjectEmployeeId: string;
}) {
  // One alert per person per hour, whatever they do in between.
  //
  // The recorder fires once per browser session, which is the right unit for "somebody signed
  // in" and the wrong one for "tell an administrator". A refused or waiting account can start a
  // new session as often as it likes by signing out and back in, and each one would otherwise be
  // a fresh notification and a fresh email. That is an inbox nobody reads within a day, which
  // costs more than the alerts are worth — the sign_in_events table keeps the complete record
  // either way, so nothing is lost by not sending every one of them.
  //
  // Keyed per subject rather than globally so one noisy account cannot mask a different person's
  // first request for access.
  const { allowed } = await checkRateLimit(
    `signin-alert:${input.subjectEmployeeId}`,
    1,
    60 * 60
  );
  if (!allowed) return;

  const admins = await activeAdmins();

  await Promise.allSettled(
    admins.flatMap((admin) => [
      createNotification({
        employeeId: admin.id,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link
      }),
      sendEmail({
        to: admin.email,
        subject: `SYRIX Forma — ${input.title}`,
        body: `${input.body}\n\nReview it here: ${appUrl()}${input.link}`
      })
    ])
  );
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
}

/**
 * Records this session if it has not been recorded, and alerts administrators when it is either
 * a request for access or a known account appearing on a device it has never used.
 *
 * Idempotent by the unique constraint on (employeeId, clerkSessionId) rather than by checking
 * first: two concurrent requests at the start of a session would both pass a check-then-insert,
 * and the second alert would be indistinguishable from a real second sign-in.
 */
export async function recordSignIn(employee: EmployeeRow, clerkSessionId: string): Promise<void> {
  try {
    const headerList = await headers();
    const { ipAddress, country, userAgent } = requestOrigin(headerList);

    // A request with no usable device cookie is recorded as its own one-off device rather than
    // being dropped or folded in with a previous one. It reports as new, which is the safe way
    // round: an extra alert costs an administrator a glance, a suppressed one costs the account.
    const deviceId = (await currentDeviceId()) ?? `unknown:${clerkSessionId}`;

    // Asked before the insert, so this session's own row cannot count as prior history.
    const [seenBefore] = await db
      .select({ id: signInEvents.id })
      .from(signInEvents)
      .where(and(eq(signInEvents.employeeId, employee.id), eq(signInEvents.deviceId, deviceId)))
      .limit(1);
    const newDevice = !seenBefore;

    const inserted = await db
      .insert(signInEvents)
      .values({
        employeeId: employee.id,
        clerkSessionId,
        deviceId,
        newDevice,
        ipAddress,
        userAgent,
        country,
        accountStatus: employee.status
      })
      .onConflictDoNothing({
        target: [signInEvents.employeeId, signInEvents.clerkSessionId]
      })
      .returning({ id: signInEvents.id });

    // Already recorded — this is any request after the first one in the session.
    if (inserted.length === 0) return;

    const where = [describeDevice(userAgent), ipAddress, country].filter(Boolean).join(' · ');
    const who = `${resolveDisplayName(employee)} (${employee.email})`;

    if (employee.status === 'pending') {
      await alertAdmins({
        type: 'access_requested',
        subjectEmployeeId: employee.id,
        title: 'Someone is asking for access to SYRIX Forma',
        body: `${who} signed in and is waiting to be approved or refused.\n${where}`,
        link: '/dashboard/settings/access'
      });
      return;
    }

    if (employee.status === 'active' && newDevice) {
      await alertAdmins({
        type: 'sign_in_new_device',
        subjectEmployeeId: employee.id,
        title: 'Sign-in from a new device',
        body: `${who} signed in on a device this account has not used before.\n${where}`,
        link: '/dashboard/settings/access'
      });
    }
  } catch (err) {
    // Deliberately non-fatal: see the file header. Logged so a silently broken alert path is
    // still discoverable rather than merely invisible.
    console.error('[auth/sign-in-events] failed to record sign-in:', err);
  }
}

export type LatestSignIn = {
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  createdAt: Date;
};

/**
 * The most recent sign-in for each of the given employees.
 *
 * Backs the approval queue: deciding whether to let someone in means seeing where the request
 * came from, not just that it exists. Takes the ids the caller has already authorised rather
 * than reading the whole table, so this can never widen what a screen shows.
 */
export async function latestSignInByEmployee(
  employeeIds: string[]
): Promise<Map<string, LatestSignIn>> {
  if (employeeIds.length === 0) return new Map();

  const rows = await db
    .select({
      employeeId: signInEvents.employeeId,
      ipAddress: signInEvents.ipAddress,
      userAgent: signInEvents.userAgent,
      country: signInEvents.country,
      createdAt: signInEvents.createdAt
    })
    .from(signInEvents)
    .where(inArray(signInEvents.employeeId, employeeIds))
    .orderBy(desc(signInEvents.createdAt));

  // First row wins per employee — the query is already sorted newest first, so this keeps the
  // latest and drops the rest without a window function or a query per person.
  const latest = new Map<string, LatestSignIn>();
  for (const row of rows) {
    if (!latest.has(row.employeeId)) latest.set(row.employeeId, row);
  }
  return latest;
}
