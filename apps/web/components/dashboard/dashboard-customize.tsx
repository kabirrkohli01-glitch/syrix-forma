'use client';

/* Lets someone hide the dashboard sections they don't personally use.
 *
 * A per-device display preference, not Hub data — nothing here is worth a
 * database round trip or a server action, so it lives in localStorage only.
 * Sections are rendered by the server (`app/dashboard/page.tsx`) exactly as
 * before; this only decides which of them stay mounted. Everyone's first
 * visit shows everything — hiding is something you opt into, not a default
 * that could make a new employee think a section doesn't exist.
 */

import React, { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';

export const DASHBOARD_SECTIONS = [
  { id: 'workload', label: 'Workload overview', description: 'The three charts.' },
  { id: 'team', label: 'Team today', description: 'Who is online right now.' },
  { id: 'attention', label: 'Needs attention', description: 'Overdue, conflicts, failures.' },
  { id: 'work', label: 'Your work', description: 'My Tasks, Upcoming, Deadlines.' },
  { id: 'watch', label: 'Client & document watch', description: 'Enquiries and missing documents.' }
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]['id'];

const STORAGE_KEY = 'syrix-forma:dashboard-sections';
const ALL_VISIBLE: Record<DashboardSectionId, boolean> = Object.fromEntries(
  DASHBOARD_SECTIONS.map((section) => [section.id, true])
) as Record<DashboardSectionId, boolean>;

/* A tiny external store rather than context + state: the preference lives in
 * localStorage, an external system, and `useSyncExternalStore` is the primitive
 * React gives you for exactly that — reading it during render with no effect
 * needed to sync it in afterwards, and a server snapshot (`ALL_VISIBLE`) that
 * matches what SSR actually rendered so hydration never mismatches. */
let cache: Record<DashboardSectionId, boolean> | null = null;
const listeners = new Set<() => void>();

function readStorage(): Record<DashboardSectionId, boolean> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...ALL_VISIBLE, ...(JSON.parse(raw) as Partial<Record<DashboardSectionId, boolean>>) } : ALL_VISIBLE;
  } catch {
    return ALL_VISIBLE;
  }
}

function getSnapshot(): Record<DashboardSectionId, boolean> {
  if (!cache) cache = readStorage();
  return cache;
}

function getServerSnapshot(): Record<DashboardSectionId, boolean> {
  return ALL_VISIBLE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSectionVisible(id: DashboardSectionId, on: boolean): void {
  cache = { ...getSnapshot(), [id]: on };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* Preference just won't persist across visits — the toggle itself still works. */
  }
  listeners.forEach((listener) => listener());
}

function useDashboardSectionsVisible(): Record<DashboardSectionId, boolean> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Wraps one dashboard section; unmounts it when the user has hidden it. */
export function DashboardSection({ id, children }: { id: DashboardSectionId; children: React.ReactNode }) {
  const visible = useDashboardSectionsVisible();
  if (!visible[id]) return null;
  return <>{children}</>;
}

/** The header button + popover of checkboxes, for `PageContainer`'s `pageHeaderAction`. */
export function DashboardCustomizeTrigger() {
  const visible = useDashboardSectionsVisible();
  const toggle = setSectionVisible;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant='outline' size='sm'>
            <Icons.settings className='size-4' />
            Customize
          </Button>
        }
      />
      <PopoverContent align='end' className='w-72'>
        <div className='space-y-3'>
          <div>
            <p className='text-sm font-medium'>Dashboard sections</p>
            <p className='text-muted-foreground text-xs'>Choose what shows on your Home screen.</p>
          </div>
          <div className='space-y-2.5'>
            {DASHBOARD_SECTIONS.map((section) => (
              <div key={section.id} className='flex items-start gap-2.5'>
                <Checkbox
                  id={`dashboard-section-${section.id}`}
                  checked={visible[section.id]}
                  onCheckedChange={(checked) => toggle(section.id, checked === true)}
                  className='mt-0.5'
                />
                <Label htmlFor={`dashboard-section-${section.id}`} className='flex flex-col gap-0.5 font-normal'>
                  <span className='text-sm font-medium'>{section.label}</span>
                  <span className='text-muted-foreground text-xs'>{section.description}</span>
                </Label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
