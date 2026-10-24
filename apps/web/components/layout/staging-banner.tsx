/**
 * Says, on every screen, that this deployment is a prototype.
 *
 * It runs on Clerk development keys (see lib/config/preflight.ts) and everything else about it is
 * identical to the real thing — same code, same schema, same permission checks. That is exactly
 * what makes it worth labelling: it looks finished, so without this somebody would put a real
 * client record in it.
 *
 * Rendered in the root layout rather than the dashboard's, so it also covers sign-in and the
 * pending-approval screen. Those are the pages a new person sees first, and where saying what
 * this is matters most.
 *
 * Deliberately not dismissible. A banner you can close is one that is closed.
 */
export function StagingBanner() {
  if (process.env.APP_ENV !== 'staging') return null;

  return (
    <div
      role='status'
      className='sticky top-0 z-50 flex w-full items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950'
    >
      <span aria-hidden='true'>&#9888;</span>
      <span>
        Prototype — built by Kabirr Kohli. Please don&apos;t put real client or case information
        in yet.
      </span>
    </div>
  );
}
