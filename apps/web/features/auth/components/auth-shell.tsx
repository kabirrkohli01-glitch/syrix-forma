import Image from 'next/image';
import { GradientMesh } from './gradient-mesh';
import { PrototypeNotice } from './prototype-notice';

// Shared by sign-in-view.tsx and sign-up-view.tsx — identical branding panel, form area, and
// watermark either way; only the tagline and the Clerk form itself differ.
export function AuthShell({ tagline, children }: { tagline: string; children: React.ReactNode }) {
  return (
    <div className='relative flex min-h-screen flex-col items-center justify-center overflow-hidden md:grid lg:max-w-none lg:grid-cols-2 lg:px-0'>
      <div className='relative hidden h-full flex-col p-10 lg:flex dark:border-r'>
        <div className='absolute inset-0 bg-sidebar' />
        <div className='text-sidebar-foreground relative z-20 flex items-center gap-2 text-lg font-medium'>
          <Image src='/forma-badge.png' alt='' width={32} height={32} className='size-8 shrink-0 rounded-lg' priority />
          SYRIX Forma
        </div>
        <GradientMesh />
        <div className='text-sidebar-foreground/70 relative z-20 mt-auto text-sm'>{tagline}</div>
      </div>
      <div className='flex h-full flex-col items-center justify-center gap-6 p-4 lg:p-8'>
        {/* The branding panel above is desktop-only (lg:flex) — mobile still gets the mark. */}
        <div className='flex items-center gap-2 text-lg font-medium lg:hidden'>
          <Image src='/forma-badge.png' alt='' width={32} height={32} className='size-8 shrink-0 rounded-lg' priority />
          SYRIX Forma
        </div>
        <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
          <PrototypeNotice />
          {children}
        </div>
      </div>
      <p className='text-muted-foreground/50 absolute right-3 bottom-3 z-20 text-xs'>
        Built by Kabirr Kohli
      </p>
    </div>
  );
}
