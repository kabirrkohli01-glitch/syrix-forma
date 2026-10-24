/**
 * Shared tone → color mapping, promoted out of app/dashboard/page.tsx so every
 * status pill in the app (Home's urgency chips, Projects/Clients/Reports status
 * badges) draws from one source of truth instead of each screen picking its own
 * colors (engineering rule 14: "no page invents its own button style").
 *
 * Every tone reuses an existing design token (primary/destructive/chart-*) rather
 * than introducing new colors — restrained blue accent stays the dominant color,
 * per engineering rule 4.
 */
export type Tone = 'neutral' | 'destructive' | 'caution' | 'info' | 'success' | 'muted';

export const TONE_CHIP_CLASSES: Record<Tone, string> = {
  neutral: 'bg-primary/10 text-primary',
  destructive: 'bg-destructive/10 text-destructive',
  caution: 'bg-chart-5/10 text-chart-5',
  info: 'bg-chart-2/10 text-chart-2',
  success: 'bg-chart-4/10 text-chart-4',
  muted: 'bg-muted text-muted-foreground'
};

export const PROJECT_STATUS_TONE = {
  active: 'neutral',
  on_hold: 'caution',
  completed: 'success',
  cancelled: 'muted'
} as const satisfies Record<string, Tone>;

export const PROJECT_STATUS_LABEL = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled'
} as const satisfies Record<keyof typeof PROJECT_STATUS_TONE, string>;

export const CLIENT_STATUS_TONE = {
  active: 'neutral',
  inactive: 'muted'
} as const satisfies Record<string, Tone>;

export const CLIENT_STATUS_LABEL = {
  active: 'Active',
  inactive: 'Inactive'
} as const satisfies Record<keyof typeof CLIENT_STATUS_TONE, string>;

export const WORK_STATUS_TONE = {
  working: 'success',
  on_break: 'caution',
  logged_off: 'muted'
} as const satisfies Record<string, Tone>;

export const WORK_STATUS_LABEL = {
  working: 'Working',
  on_break: 'On break',
  logged_off: 'Logged off'
} as const satisfies Record<keyof typeof WORK_STATUS_TONE, string>;
