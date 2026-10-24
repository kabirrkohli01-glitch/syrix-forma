/**
 * Says what this is, on the screen where somebody decides whether to hand over an email address.
 *
 * Shown only where the deployment has declared itself a prototype (APP_ENV=staging), so the same
 * component costs nothing once this becomes the real thing — there is no second build and no
 * copy to remember to take out.
 *
 * It sits above the sign-in form rather than below it because the two things a new person needs
 * before typing anything are what they are signing in to and what happens next. "Waiting for
 * approval" is otherwise a surprise that reads like a broken sign-up.
 */
import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';

export function PrototypeNotice() {
  if (process.env.APP_ENV !== 'staging') return null;

  // Two different promises, and showing the wrong one is worse than showing neither. Where the
  // Hub opens on a shared code there is no account to approve and no personal workspace waiting
  // at the end of it — everyone who enters the code sees the same one.
  const codeMode = accessCodeModeEnabled();

  return (
    <div className='border-border bg-muted/40 w-full rounded-xl border p-4 text-center'>
      <p className='text-sm font-medium'>This is a prototype of SYRIX Forma</p>
      <p className='text-muted-foreground mt-1 text-xs'>
        {codeMode
          ? 'Built by Kabirr Kohli. This preview opens on a shared code into a single demonstration account, so everyone who enters it sees the same workspace.'
          : 'Built by Kabirr Kohli. Sign in with your email and an administrator will be asked to approve you — once they do, you get your own account with your own work in it.'}
      </p>
    </div>
  );
}
