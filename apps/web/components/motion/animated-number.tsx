'use client';

import * as React from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * Counts up to `value` once on mount/change instead of popping straight in — purposeful motion
 * per engineering rule 14 (draws the eye to a real number that just loaded), not decoration.
 * Skips the animation entirely under prefers-reduced-motion, same convention as StaggerList.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const shouldReduceMotion = useReducedMotion();
  const [animatedValue, setAnimatedValue] = React.useState(0);
  const previousValue = React.useRef(0);

  React.useEffect(() => {
    if (shouldReduceMotion) return;

    const controls = animate(previousValue.current, value, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (latest) => setAnimatedValue(Math.round(latest))
    });
    previousValue.current = value;
    return () => controls.stop();
  }, [value, shouldReduceMotion]);

  const display = shouldReduceMotion ? value : animatedValue;
  return <>{display.toLocaleString()}</>;
}
