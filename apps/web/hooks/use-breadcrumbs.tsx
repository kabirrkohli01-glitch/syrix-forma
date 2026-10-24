'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

/**
 * How a path segment is written in the breadcrumb.
 *
 * The starter generated these by capitalising the first letter of the URL segment, which is fine
 * for /dashboard/clients and wrong for everything else this app has: "Hr", "Time-off", "Forma-ai",
 * "My-work". A URL segment is written for a machine; a breadcrumb is read by a person, and the
 * two only coincide by luck.
 *
 * A segment with no entry here falls back to title case with hyphens turned into spaces, which is
 * right for anything conventionally named and keeps a new route from looking broken before
 * anybody remembers to add it.
 */
const SEGMENT_TITLES: Record<string, string> = {
  dashboard: 'Home',
  'my-work': 'My Work',
  hr: 'HR',
  'time-off': 'Time Off',
  'forma-ai': 'SYRIX AI',
  'project-templates': 'Project Templates',
  access: 'People & Access',
  chat: 'Team Chat',
  reports: 'Reports'
};

/** A UUID segment is a record id, and nobody reading a breadcrumb wants to see one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleFor(segment: string): string {
  const known = SEGMENT_TITLES[segment];
  if (known) return known;

  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The trail for one path. Pure, and exported so it can be tested without a DOM — the whole of
 * the behaviour worth asserting here is a string in and a list out.
 */
export function breadcrumbsFor(pathname: string | null): BreadcrumbItem[] {
  // `usePathname` is typed `string | null`, and this used to call .split on it unguarded, which
  // would throw inside the header — on every screen at once.
  if (!pathname) return [];

  const segments = pathname.split('/').filter(Boolean);

  return segments.reduce<BreadcrumbItem[]>((items, segment, index) => {
    const link = `/${segments.slice(0, index + 1).join('/')}`;

    // A record id is dropped rather than rendered. The page it belongs to already names the
    // record in its own heading, so showing the id adds nothing and costs a line of unreadable
    // hex on every detail screen.
    if (UUID.test(segment)) return items;

    items.push({ title: titleFor(segment), link });
    return items;
  }, []);
}

export function useBreadcrumbs() {
  const pathname = usePathname();
  return useMemo(() => breadcrumbsFor(pathname), [pathname]);
}
