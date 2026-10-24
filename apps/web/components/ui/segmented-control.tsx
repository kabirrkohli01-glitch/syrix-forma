'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import * as React from 'react';
import { springSnappy } from '@/components/motion/springs';
import { cn } from '@/lib/utils';

export type SegmentedItem = {
  value: string;
  label: string;
  /** Render this segment as a link. Omit for a button driving local state. */
  href?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps = {
  items: SegmentedItem[];
  value: string;
  onValueChange?: (value: string) => void;
  /** Accessible name — required, since the control on its own reads as an unlabelled list of links. */
  label: string;
  className?: string;
};

/**
 * Horizontal control for switching between mutually exclusive views of the same
 * screen — the sub-navigation inside a large module, or a view toggle.
 *
 * Two modes, chosen per item rather than per control: an item with `href` renders
 * as a link (deep-linkable, server-rendered destination, back button works), one
 * without renders as a button calling `onValueChange`. A control must not mix the
 * two — either the selection is addressable or it is local state, and a half-and-half
 * control would make the back button work for some segments and not others.
 *
 * The selected pill is a single shared element moved between segments via `layoutId`,
 * not a per-segment background fading in and out. That is what makes the selection
 * read as one object being moved rather than two objects swapping visibility, and it
 * is why the motion is worth having at all (engineering rule 14 — motion that helps
 * the user follow a state change, not decoration).
 */
export function SegmentedControl({
  items,
  value,
  onValueChange,
  label,
  className
}: SegmentedControlProps) {
  const shouldReduceMotion = useReducedMotion();
  // Scopes the shared-layout animation to this instance. Two controls rendered on the
  // same screen with a shared id would animate their pills into each other.
  const layoutId = `segmented-${React.useId()}`;

  const isLinkMode = items.some((item) => item.href);
  const Container = isLinkMode ? 'nav' : 'div';

  return (
    <Container
      aria-label={label}
      role={isLinkMode ? undefined : 'group'}
      className={cn(
        // With eleven sub-tabs this overflows on a phone, so it scrolls horizontally
        // rather than wrapping to a second row — a wrapped segmented control loses the
        // single-track reading that makes it a segmented control. scroll-fade-x is the
        // app's existing edge-fade utility (styles/globals.css), which signals there is
        // more to scroll to without adding a scrollbar.
        // -mx-1/px-1 keeps the focus ring on the first and last segment from being
        // clipped by the scroll container.
        'scroll-fade-x -mx-1 flex snap-x snap-mandatory items-center gap-0.5 overflow-x-auto px-1 py-1',
        className
      )}
    >
      <div className='bg-muted flex w-max items-center gap-0.5 rounded-[calc(var(--radius-md)+2px)] p-0.5'>
        {items.map((item) => {
          const isActive = item.value === value;

          const inner = (
            <>
              {isActive && !shouldReduceMotion && (
                <motion.span
                  layoutId={layoutId}
                  transition={springSnappy}
                  className='bg-card ring-foreground/5 absolute inset-0 rounded-[var(--radius-md)] shadow-xs ring-1'
                />
              )}
              {isActive && shouldReduceMotion && (
                <span className='bg-card ring-foreground/5 absolute inset-0 rounded-[var(--radius-md)] shadow-xs ring-1' />
              )}
              <span className='relative z-10 flex items-center gap-1.5'>
                {item.icon}
                {item.label}
              </span>
            </>
          );

          const classes = cn(
            // This control is how the HR section and the document filters are navigated, so on a
            // touch device each segment is raised to the 44px minimum. It is a bespoke control
            // rather than a Button, so it does not inherit the same accommodation from there.
            'relative flex h-8 shrink-0 snap-start items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-medium whitespace-nowrap outline-none pointer-coarse:h-11',
            'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
            'focus-visible:ring-ring/50 focus-visible:ring-3',
            isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            item.disabled && 'pointer-events-none opacity-50',
            "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          );

          // A disabled item is rendered as a disabled button even in link mode. Leaving it as
          // an anchor and relying on pointer-events-none only blocks the mouse — the link
          // stays focusable and Enter still navigates, so the "disabled" state would hold for
          // a pointer user and silently not hold for a keyboard or screen reader user.
          if (item.disabled) {
            return (
              <button key={item.value} type='button' disabled className={classes}>
                {inner}
              </button>
            );
          }

          if (item.href) {
            return (
              <Link
                key={item.value}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={classes}
              >
                {inner}
              </Link>
            );
          }

          return (
            <button
              key={item.value}
              type='button'
              aria-pressed={isActive}
              onClick={() => onValueChange?.(item.value)}
              className={classes}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </Container>
  );
}
