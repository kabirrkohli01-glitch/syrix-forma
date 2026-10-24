import type { Transition } from 'motion/react';

/**
 * Shared spring presets (engineering rule 14: motion must be purposeful, tied to a
 * real state change, never decorative). Critically damped / near-zero overshoot on
 * both — the goal is physical, snappy feedback, not a bouncy flourish.
 *
 * `springSnappy` — direct-manipulation feedback: press/tap, drag, anything the user's
 * finger or cursor is actively driving. High stiffness so it reads as immediate.
 *
 * `springSmooth` — a surface appearing/disappearing on its own (panel, sheet, dropdown,
 * dialog) rather than being dragged — slightly softer so it doesn't feel twitchy.
 *
 * Page-level content swaps (RouteTransition) deliberately do NOT use either of these —
 * springing an entire page would read as decorative rather than physical.
 */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 32,
  mass: 0.7
};

export const springSmooth: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8
};

/** Standard press/tap feedback — pair with `whileTap` on a `motion.*` element. */
export const tapScale = { scale: 0.97 };
