'use client';

import { Icons } from '@/components/icons';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd } from '@/components/ui/kbd';
import { startThemeTransition } from '@/lib/theme-transition';

type ThemeMode = 'light' | 'dark' | 'system';

const MODE_ICON: Record<ThemeMode, keyof typeof Icons> = {
  light: 'sun',
  dark: 'moon',
  system: 'laptop'
};

const noopSubscribe = () => () => {};

/** True only once the client has taken over — never via setState-in-effect, which would
 * itself trigger an extra render; useSyncExternalStore is the React-recommended way to
 * read this without that cascade. */
function useIsClient() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/**
 * A real 3-way light/dark/system control (engineering rule 4 requires all three
 * modes to be genuinely available, not just supported by next-themes' config) — a
 * menu rather than a cycling icon button, so the current mode and the other two
 * choices are both visible at once, like macOS/iOS's Appearance setting.
 */
export function ThemeModeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const currentMode: ThemeMode = theme === 'light' || theme === 'dark' ? theme : 'system';

  // next-themes can't know the real theme during SSR (it lives in localStorage), so
  // resolvedTheme is undefined on the server and on the client's first paint — picking
  // an icon from it before mount renders sun server-side and moon client-side, a
  // hydration mismatch. Render the theme-agnostic glyph until mounted, then switch.
  const isClient = useIsClient();
  const TriggerIcon = isClient
    ? Icons[resolvedTheme === 'dark' ? 'moon' : 'sun']
    : Icons.brightness;

  const applyMode = React.useCallback(
    (mode: string, e?: React.MouseEvent) => {
      // Circular reveal from the click point (falls back to center for the
      // keyboard shortcut, which passes no event).
      startThemeTransition(() => setTheme(mode as ThemeMode), e);
    },
    [setTheme]
  );

  // Cmd/Ctrl+Shift+D cycles light -> dark -> system; kbar separately handles 'D D'.
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'd' || !e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      const next: ThemeMode =
        currentMode === 'light' ? 'dark' : currentMode === 'dark' ? 'system' : 'light';
      applyMode(next);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentMode, applyMode]);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant='secondary' size='icon' className='group/toggle size-8' />}
            />
          }
        >
          <TriggerIcon />
          <span className='sr-only'>Change theme</span>
        </TooltipTrigger>
        <TooltipContent>
          Theme <Kbd>⌘⇧D</Kbd> <Kbd>D D</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className='min-w-36'>
        <DropdownMenuRadioGroup value={currentMode} onValueChange={(value) => applyMode(value)}>
          {(['light', 'dark', 'system'] as const).map((mode) => {
            const ModeIcon = Icons[MODE_ICON[mode]];
            return (
              <DropdownMenuRadioItem key={mode} value={mode}>
                <ModeIcon className='mr-1.5' />
                <span className='capitalize'>{mode}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
