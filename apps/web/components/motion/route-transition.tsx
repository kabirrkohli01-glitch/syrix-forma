'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

/**
 * Fades page content in on route change instead of an abrupt swap. Kept purely
 * presentational — layout.tsx does the real auth/permission gating server-side
 * before this ever renders (engineering rule 10: a UI transition is never a
 * security control).
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode='wait' initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' as const }}
        /* MUST participate in the layout it sits inside.
           This div is a flex item of SidebarInset's column. Without these
           classes it sizes to its content, so every page's own `flex-1` had
           nothing to fill and pages that should reach the bottom of the window
           collapsed to the height of their text. The wrapper is presentational
           and must be invisible to layout — which means matching the box it
           replaced, not being unstyled. `min-h-0` lets a scrolling child
           shrink rather than forcing this container taller, and `min-w-0` is
           the same release on the horizontal axis: without it this wrapper
           grows to its widest descendant and re-creates the page-wide sideways
           scroll that SidebarInset's own `min-w-0` exists to prevent. */
        className='flex w-full min-h-0 min-w-0 flex-1 flex-col'
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
