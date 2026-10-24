'use client';

import { usePathname } from 'next/navigation';
import { Icons } from '@/components/icons';
import { SegmentedControl, type SegmentedItem } from '@/components/ui/segmented-control';
import { HR_TABS } from '@/config/hr-nav';

/**
 * Sub-navigation shown at the top of every HR screen.
 *
 * Rendered per page rather than from a shared `layout.tsx` so each HR route stays a plain
 * server component that fetches only its own data — a layout wrapping them would still render
 * on every navigation between tabs, and the tabs themselves need no server data.
 */
export function HrTabs() {
  const pathname = usePathname();

  // People is mounted at the module root, so an exact match decides it and a prefix match
  // decides the rest. Prefix matching keeps the right tab selected on detail routes such as
  // /dashboard/hr/time-off/<id>, which would otherwise clear the selection entirely.
  //
  // `usePathname` is typed `string | null` and this read it unguarded, so a null would throw and
  // take down every screen in the HR module — the tabs render on all eleven of them. Falling
  // back to People is the same answer the `?? 'people'` below already gives.
  const active =
    HR_TABS.find((tab) => tab.href !== '/dashboard/hr' && pathname?.startsWith(tab.href))?.value ??
    'people';

  const items: SegmentedItem[] = HR_TABS.map((tab) => ({
    value: tab.value,
    label: tab.label,
    href: tab.href,
    icon: (() => {
      const Icon = Icons[tab.icon];
      return <Icon aria-hidden />;
    })(),
    disabled: tab.stage !== undefined
  }));

  return <SegmentedControl label='HR sections' items={items} value={active} />;
}
