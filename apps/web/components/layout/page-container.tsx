import React from 'react';
import { Heading } from '../ui/heading';
import type { InfobarContent } from '@/components/ui/infobar';

function PageSkeleton() {
  return (
    <div
      role='status'
      aria-label='Loading page'
      className='flex flex-1 animate-pulse flex-col gap-4 p-4 md:px-6'
    >
      <div className='flex items-center justify-between'>
        <div>
          <div className='bg-muted mb-2 h-8 w-full max-w-48 rounded' />
          {/* Capped, not fixed: `w-96` is 384px and overflows any phone narrower than that. */}
          <div className='bg-muted h-4 w-full max-w-96 rounded' />
        </div>
      </div>
      <div className='bg-muted mt-6 h-40 w-full rounded-lg' />
      <div className='bg-muted h-40 w-full rounded-lg' />
    </div>
  );
}

export default function PageContainer({
  children,
  isLoading = false,
  access = true,
  accessFallback,
  pageTitle,
  pageDescription,
  infoContent,
  pageHeaderAction
}: {
  children: React.ReactNode;
  isLoading?: boolean;
  access?: boolean;
  accessFallback?: React.ReactNode;
  pageTitle?: string;
  pageDescription?: string;
  infoContent?: InfobarContent;
  pageHeaderAction?: React.ReactNode;
}) {
  if (!access) {
    return (
      <div role='status' className='flex flex-1 items-center justify-center p-4 md:px-6'>
        {accessFallback ?? (
          <div className='text-muted-foreground text-center text-lg'>
            You do not have access to this page.
          </div>
        )}
      </div>
    );
  }

  const content = isLoading ? <PageSkeleton /> : children;

  const hasHeader = pageTitle || pageHeaderAction;

  return (
    // `min-w-0` completes the chain that starts at SidebarInset: every flex container between the
    // main pane and the page body has to decline to size itself to its content, or the widest
    // element on the page still sets the width of the document.
    <div className='flex w-full min-w-0 flex-1 flex-col px-4 pt-2 pb-4 md:px-6 md:pt-4'>
      {hasHeader && (
        // Title and actions sit side by side only once there is room for both. Below `sm` the
        // action block can be wider than the whole viewport on its own — a five-way view switcher,
        // or a filter row plus a primary button — and as an unshrinkable item on the same line it
        // pushed the page wider than the screen. Stacking is what makes the action able to wrap
        // within the viewport instead of extending past it.
        <div className='mb-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
          <div className='min-w-0'>
            <Heading
              title={pageTitle ?? ''}
              description={pageDescription ?? ''}
              infoContent={infoContent}
            />
          </div>
          {pageHeaderAction && <div className='min-w-0 sm:shrink-0'>{pageHeaderAction}</div>}
        </div>
      )}
      {content}
    </div>
  );
}
