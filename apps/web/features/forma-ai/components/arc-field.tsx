'use client';

/* The arc field behind the empty state.
 *
 * IT MOVES ONCE. The arcs sweep up into place over about two seconds when the
 * screen is opened, and then hold. It is a transition into a resting state, not
 * a loop: a background that keeps moving behind text is decoration, it competes
 * with the thing being read, and after the third time you see it, it is noise.
 * The geometry and the timing live in `styles/forma-ai.css`; this component only
 * decides WHEN the one animation is allowed to run.
 *
 * IT RUNS ON MOUNT, NOT ON EVERY RENDER. The class that triggers it is removed
 * once it has finished, so a re-render mid-conversation cannot restart it. The
 * side panel and the full tab mount separately, so opening either plays it once
 * — which is right, because each is a fresh arrival at the screen.
 *
 * IT IS ONLY BEHIND THE EMPTY STATE. Once there is an answer on screen the
 * field is gone: the arcs are bright enough to fight with body text, and a
 * conversation is a reading surface.
 *
 * `prefers-reduced-motion` is honoured in the stylesheet, which renders the
 * resting state immediately rather than a faster version of the movement.
 */

import React, { useEffect, useState } from 'react';

/* Matches the longest arc animation plus its stagger, with a little slack. When
   it elapses the settling attribute is dropped and what remains is the plain
   static styling — so the resting appearance is described in exactly one place
   and cannot drift from where the animation lands. */
const SETTLE_MS = 2200;

export function ArcField({ className }: { className?: string }) {
  const [settling, setSettling] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`forma-ai-field ${className ?? ''}`} data-settling={settling} aria-hidden>
      <div className='forma-ai-bloom' />
      <div className='forma-ai-arc forma-ai-arc-3' />
      <div className='forma-ai-arc forma-ai-arc-2' />
      <div className='forma-ai-arc forma-ai-arc-1' />
    </div>
  );
}
