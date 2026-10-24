import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { NextResponse, type NextRequest } from 'next/server';
import { recordLockout } from '@/lib/auth/record-lockout';
import { bootstrapEmployeeRow } from '@/lib/onboarding/bootstrap-employee';

export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  if (evt.type === 'user.created') {
    const user = evt.data;
    const primaryEmail =
      user.email_addresses.find((e) => e.id === user.primary_email_address_id)?.email_address ??
      user.email_addresses[0]?.email_address ??
      '';
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || primaryEmail;

    // Only reachable at all once this app has a public URL Clerk's servers can deliver to (see
    // lib/onboarding/bootstrap-employee.ts's other caller, getEmployeeRow's lazy-provisioning
    // fallback, for the path that covers plain localhost dev where this webhook can never fire).
    await bootstrapEmployeeRow({ clerkUserId: user.id, name, email: primaryEmail });
    return NextResponse.json({ received: true });
  }

  /*
   * Clerk counts failed passwords and locks the account; the sign-in form is Clerk's, so those
   * attempts never reach this server and there is nothing here to count. What Clerk will not do
   * is make a repeat lockout cost more than the first, or tell anyone it happened — both of
   * which are added here, off this event.
   *
   * `user.updated` fires for every change to a user, so the lock has to be recognised rather
   * than assumed: only a user that is locked now and was not already locked in the Hub's own
   * record counts. Without that second half, any later edit to a still-locked user would
   * escalate them again for one real event.
   */
  if (evt.type === 'user.updated') {
    const user = evt.data as { id: string; locked?: boolean };
    if (user.locked) await recordLockout(user.id);
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
