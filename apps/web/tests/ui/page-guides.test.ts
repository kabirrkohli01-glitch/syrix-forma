import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as guides from '@/config/page-guides';
import type { InfobarContent } from '@/components/ui/infobar';

/**
 * engineering rule 17 requires every screen to answer what am I looking at, what can I do here,
 * and what needs my attention. The guide panel is how this app answers it, and a guide is easy to
 * forget when adding a page — the panel spent its whole existence showing the starter template's
 * placeholder text precisely because nothing ever noticed no page had passed it any content.
 *
 * These are the checks that keep that from happening again, and they read the source rather than
 * rendering, because what is being asserted is that each page *has* a guide.
 */

const DASHBOARD = path.join(process.cwd(), 'app', 'dashboard');

/** Detail routes take their context from the record they show and get no guide of their own. */
function isSectionPage(relative: string): boolean {
  return !relative.includes('[');
}

function sectionPages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sectionPages(full, acc);
    else if (entry.name === 'page.tsx') acc.push(full);
  }
  return acc;
}

const pages = sectionPages(DASHBOARD)
  .map((abs) => ({ abs, relative: path.relative(DASHBOARD, abs).replaceAll('\\', '/') }))
  .filter((page) => isSectionPage(page.relative));

describe('every dashboard section explains itself', () => {
  it('found the pages to check', () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  /**
   * Screens that draw their own heading instead of PageContainer's, and therefore mount the
   * guide button inside their own component. The file and the component that carries it are
   * both named, so this is an accounted-for exception rather than a hole.
   */
  const GUIDE_IN_OWN_HEADER: Record<string, string> = {
    'forma-ai/page.tsx': 'features/forma-ai/components/forma-ai-tab.tsx'
  };

  it.each(pages.map((page) => page.relative))('%s offers a guide', (relative) => {
    const source = readFileSync(path.join(DASHBOARD, relative), 'utf8');
    const elsewhere = GUIDE_IN_OWN_HEADER[relative];

    if (elsewhere) {
      const component = readFileSync(path.join(process.cwd(), elsewhere), 'utf8');
      expect(component).toContain('<InfoButton');
      return;
    }

    expect(source).toContain('infoContent=');
  });
});

describe('the guides themselves', () => {
  const entries = Object.entries(guides).filter(([name]) => name.endsWith('_GUIDE')) as [
    string,
    InfobarContent
  ][];

  it('found the guides', () => {
    expect(entries.length).toBeGreaterThan(15);
  });

  it.each(entries.map(([name]) => name))('%s has a title and real sections', (name) => {
    const guide = Object.fromEntries(entries)[name];
    expect(guide.title.length).toBeGreaterThan(0);
    expect(guide.sections.length).toBeGreaterThanOrEqual(3);
    for (const section of guide.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      // Long enough to be an explanation rather than a restatement of the page title.
      expect(section.description.length).toBeGreaterThan(40);
    }
  });

  it('links nowhere that does not exist', () => {
    // `links` is for real destinations. A placeholder '#' is how the starter template's own
    // panel content read, and shipping one is the thing Section 14 rules out.
    for (const [, guide] of entries) {
      for (const section of guide.sections) {
        for (const link of section.links ?? []) {
          expect(link.url).not.toBe('#');
          expect(link.url).toMatch(/^(https?:\/\/|\/)/);
        }
      }
    }
  });
});
