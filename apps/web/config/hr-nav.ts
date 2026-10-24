import type { Icons } from '@/components/icons';

/**
 * Sub-navigation for the HR module.
 *
 * HR is one sidebar entry with a segmented control inside it rather than eleven top-level
 * sidebar items. At eleven, the sidebar would roughly double in length and stop being
 * scannable, and every one of these is a view of the same subject — the people who work here —
 * which is exactly the case a segmented control exists for.
 *
 * `stage` mirrors the `phase` field on the main nav (config/nav-config.ts): a tab whose stage
 * has not shipped renders disabled rather than being hidden, so the shape of the module is
 * visible from the first screen and nothing gets bolted on later. engineering rule 7 requires
 * unbuilt things to be obviously unbuilt — a disabled tab is honest, a tab leading to an empty
 * page pretending to be finished is not.
 */
export type HrTab = {
  value: string;
  label: string;
  href: string;
  icon: keyof typeof Icons;
  /** Which build stage ships this tab. Undefined means it has shipped. */
  stage?: number;
};

export const HR_TABS: HrTab[] = [
  { value: 'people', label: 'People', href: '/dashboard/hr', icon: 'people' },
  { value: 'time-off', label: 'Time Off', href: '/dashboard/hr/time-off', icon: 'timeOff' },
  { value: 'absence', label: 'Absence', href: '/dashboard/hr/absence', icon: 'absence' },
  { value: 'documents', label: 'Documents', href: '/dashboard/hr/documents', icon: 'signature' },
  {
    value: 'performance',
    label: 'Performance',
    href: '/dashboard/hr/performance',
    icon: 'goal'
  },
  { value: 'rotas', label: 'Rotas', href: '/dashboard/hr/rotas', icon: 'rota' },
  { value: 'expenses', label: 'Expenses', href: '/dashboard/hr/expenses', icon: 'expenses' },
  { value: 'learning', label: 'Learning', href: '/dashboard/hr/learning', icon: 'learning' },
  { value: 'safety', label: 'Safety', href: '/dashboard/hr/safety', icon: 'safety' },
  { value: 'hiring', label: 'Hiring', href: '/dashboard/hr/hiring', icon: 'hiring' },
  { value: 'reports', label: 'HR Reports', href: '/dashboard/hr/reports', icon: 'chartBar' },
  // Last deliberately, because it is the least-visited tab — but present for everyone rather
  // than hidden from non-HR, since a settings tab that only appears for people who already know
  // they have the permission is no help to the person wondering why they cannot change anything.
  // The page itself explains what would let them in.
  { value: 'settings', label: 'Settings', href: '/dashboard/hr/settings', icon: 'settings' }
];
