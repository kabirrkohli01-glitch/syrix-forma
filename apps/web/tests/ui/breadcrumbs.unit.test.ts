import { describe, expect, it, vi } from 'vitest';

// The hook is a useMemo around a pure function; that function is what is asserted here, so no
// DOM and no rendering library is needed. next/navigation is stubbed only because importing the
// module pulls it in.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const { breadcrumbsFor: crumbsFor } = await import('@/hooks/use-breadcrumbs');

describe('breadcrumbs', () => {
  it('writes each segment the way a person would say it', () => {
    expect(crumbsFor('/dashboard/my-work').map((c) => c.title)).toEqual(['Home', 'My Work']);
    expect(crumbsFor('/dashboard/hr/time-off').map((c) => c.title)).toEqual([
      'Home',
      'HR',
      'Time Off'
    ]);
    expect(crumbsFor('/dashboard/forma-ai').map((c) => c.title)).toEqual(['Home', 'SYRIX AI']);
  });

  it('falls back to title case for a segment nobody has named yet', () => {
    expect(crumbsFor('/dashboard/some-new-thing').map((c) => c.title)).toEqual([
      'Home',
      'Some New Thing'
    ]);
  });

  it('drops a record id instead of printing raw hex in the header', () => {
    const crumbs = crumbsFor('/dashboard/clients/6b1d5c58-1f4a-4f37-9f9a-2a3f5f6e7d8c');
    expect(crumbs.map((c) => c.title)).toEqual(['Home', 'Clients']);
  });

  it('keeps each crumb linking to its own level', () => {
    expect(crumbsFor('/dashboard/hr/time-off').map((c) => c.link)).toEqual([
      '/dashboard',
      '/dashboard/hr',
      '/dashboard/hr/time-off'
    ]);
  });

  it('survives a null pathname rather than throwing inside the header', () => {
    expect(crumbsFor(null)).toEqual([]);
  });
});
