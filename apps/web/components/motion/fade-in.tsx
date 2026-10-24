'use client';

import * as React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { springSmooth } from './springs';

/**
 * A short, purposeful mount transition (fade + small rise) for cards, panels, and
 * list rows. Delay is staggered by callers via the `delay` prop rather than a
 * container variant, since most call sites render a flat list of independent
 * cards rather than a single animated tree.
 */
export function FadeIn({
  delay = 0,
  className,
  children,
  ...rest
}: Omit<HTMLMotionProps<'div'>, 'children'> & { delay?: number; children: React.ReactNode }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSmooth, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
