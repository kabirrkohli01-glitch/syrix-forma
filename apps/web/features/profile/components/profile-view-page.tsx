import PageContainer from '@/components/layout/page-container';
import { SETTINGS_GUIDE } from '@/config/page-guides';
import { SignOutOtherSessionsButton } from '@/features/profile/components/sign-out-other-sessions-button';
import { PreferencesForm } from '@/features/profile/components/preferences-form';
import { accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { UserProfile } from '@clerk/nextjs';

export default function ProfileViewPage({ preferredName }: { preferredName: string }) {
  return (
    <PageContainer
      pageTitle='Account & Security'
      pageDescription='The name the Hub shows for you, how it looks on this device, and your sign-in security.'
      infoContent={SETTINGS_GUIDE}
    >
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8'>
        <PreferencesForm initialName={preferredName} />

        {/* Everything below this point is the account itself — password, second factor, active
            sessions — and none of it exists where the Hub was opened with a shared code instead
            of an account. Clerk's widget renders its signed-out state there, which reads as a
            broken page rather than as "this deployment has no accounts". */}
        {accessCodeModeEnabled() ? (
          <div className='border-border bg-muted/40 rounded-xl border p-4'>
            <h2 className='text-base font-semibold'>Account & security</h2>
            <p className='text-muted-foreground mt-1 text-sm'>
              This preview opens on a shared access code rather than individual accounts, so there
              is no password, no second factor and no session list to manage here. The name above
              is the only setting that applies.
            </p>
          </div>
        ) : (
          <>
            <div className='flex items-center justify-between'>
              <h2 className='text-base font-semibold'>Account & security</h2>
              <SignOutOtherSessionsButton />
            </div>

            {/* Centered rather than left-anchored at the container's natural width —
                Clerk's own widget has no opinion on page layout, so left unwrapped it
                renders flush against whatever the parent happens to be, which reads
                as a cramped top-left block on a page with room either side of it. */}
            <div className='mx-auto w-full'>
              <UserProfile
                appearance={{
                  elements: {
                    rootBox: 'w-full',
                    cardBox: 'w-full shadow-none border border-border rounded-xl'
                  }
                }}
              />
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
}
