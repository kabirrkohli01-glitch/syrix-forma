'use client';

import * as React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { springSmooth } from './springs';

const CONTAINER_VARIANTS = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } }
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: springSmooth }
};

type MotionDivProps = Omit<HTMLMotionProps<'div'>, 'children'> & { children: React.ReactNode };

/**
 * Wrap a list of `StaggerItem`s to fade/rise them in one after another instead
 * of all at once — the same short 200ms motion as `FadeIn`, just sequenced.
 */
export function StaggerList({ className, children, ...rest }: MotionDivProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial='hidden'
      animate='show'
      variants={CONTAINER_VARIANTS}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children, ...rest }: MotionDivProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={ITEM_VARIANTS} {...rest}>
      {children}
    </motion.div>
  );
}
