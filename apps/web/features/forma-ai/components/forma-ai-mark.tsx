'use client';

/* The SYRIX AI mark.
 *
 * Just the logo. No badge, no ring, no plate behind it — the artwork is a
 * finished mark and putting it inside a circle it was not drawn for reads as a
 * logo trapped in a container.
 *
 * That was not possible with the file as supplied: it was gold on opaque black,
 * so it needed a dark mount to blend against. `scripts/make-logo-transparent.mjs`
 * cut the background out and trimmed the empty margin, so the asset is now the
 * mark and nothing else. `size` is therefore the size of the LOGO, not of a box
 * the logo sits inside a fraction of.
 *
 * Width is fixed and height follows the artwork's own ratio, so it can never be
 * squashed by a caller passing a square size to a mark that is not square.
 */

import Image from 'next/image';
import React from 'react';

import { cn } from '@/lib/utils';

/* The trimmed asset's own dimensions. Kept here so Next can reserve the right
   space before the image loads and the layout does not jump. */
const NATURAL_WIDTH = 512;
const NATURAL_HEIGHT = 512;

export function FormaAiMark({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <Image
      src='/forma-ai-mark.png'
      alt='SYRIX AI'
      width={NATURAL_WIDTH}
      height={NATURAL_HEIGHT}
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: 'auto' }}
      priority
    />
  );
}
