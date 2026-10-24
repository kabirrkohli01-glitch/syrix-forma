/* View config for My Work, split out of `task-view-toggle.tsx` deliberately.
 *
 * That file is a `'use client'` component. A Server Component (the `my-work`
 * page) imported `TASK_VIEW_VALUES` from it to validate a search param, and in
 * production that constant arrived as something other than a plain array —
 * `.includes` was not a function, because a named export pulled out of a
 * client module across the server/client boundary is not guaranteed to be the
 * value itself. Plain data with no client-only dependencies belongs in its own
 * server-safe module; only the component that renders it belongs in the
 * client one.
 */

export const TASK_VIEW_VALUES = ['list', 'board', 'calendar', 'timeline', 'day'] as const;
export type TaskView = (typeof TASK_VIEW_VALUES)[number];
