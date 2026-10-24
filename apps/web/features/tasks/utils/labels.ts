import type { Tone } from '@/lib/status-colors';
import type { taskPriorityValues, taskStatusValues } from './schemas';

export const TASK_STATUS_LABEL: Record<(typeof taskStatusValues)[number], string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done'
};

// Tone-mapped pill for the Status column, reusing the same TONE_CHIP_CLASSES palette every
// other status pill in the app draws from (lib/status-colors.ts) rather than a one-off color.
export const TASK_STATUS_TONE: Record<(typeof taskStatusValues)[number], Tone> = {
  todo: 'muted',
  in_progress: 'neutral',
  blocked: 'destructive',
  done: 'success'
};

export const TASK_PRIORITY_VARIANT: Record<
  (typeof taskPriorityValues)[number],
  'destructive' | 'default' | 'secondary' | 'outline'
> = {
  urgent: 'destructive',
  high: 'default',
  medium: 'secondary',
  low: 'outline'
};

// Priority is shown as a single colored flag icon in the table (not a text badge) — the tone
// drives the icon color.
export const TASK_PRIORITY_TONE: Record<(typeof taskPriorityValues)[number], Tone> = {
  urgent: 'destructive',
  high: 'destructive',
  medium: 'caution',
  low: 'muted'
};
