'use client';

/* Personal preferences that sit above the Clerk profile form: what the Hub calls
 * this person, and how it looks for them. Both save on change — same reasoning
 * as `features/forma-ai/components/ai-settings-form.tsx`: each control is small,
 * instantly reversible, and a Save button here would just be a extra click
 * between the user and a change they already decided on.
 */

import React, { useState, useTransition } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Icons } from '@/components/icons';

import { updatePreferredName } from '../actions';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: 'sun' as const },
  { value: 'dark', label: 'Dark', icon: 'moon' as const },
  { value: 'system', label: 'System', icon: 'laptop' as const }
];

export function PreferencesForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [pending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();

  const saveName = (): void => {
    if (name.trim() === savedName.trim()) return;

    startTransition(async () => {
      try {
        const result = await updatePreferredName(name);
        setName(result.displayName);
        setSavedName(result.displayName);
      } catch (error) {
        setName(savedName);
        toast.error(error instanceof Error ? error.message : 'That could not be saved.');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Preferences</CardTitle>
        <CardDescription>
          How the Hub greets you and how SYRIX AI addresses you, plus how the app looks on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        <div className='space-y-1.5'>
          <Label htmlFor='preferred-name'>Preferred name</Label>
          <Input
            id='preferred-name'
            value={name}
            maxLength={60}
            placeholder='Your name from Clerk'
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            className='max-w-xs'
          />
          <p className='text-muted-foreground text-xs'>
            Shown on the dashboard and used when SYRIX AI talks to you. Leave blank to use your account
            name. This never changes what colleagues see for you elsewhere in the Hub.
          </p>
        </div>

        <div className='space-y-1.5'>
          <Label>Appearance</Label>
          <RadioGroup
            value={theme ?? 'system'}
            onValueChange={(value) => setTheme(value)}
            className='grid max-w-sm grid-cols-3 gap-2'
          >
            {THEME_OPTIONS.map((option) => {
              const Icon = Icons[option.icon];
              return (
                <Label
                  key={option.value}
                  htmlFor={`theme-${option.value}`}
                  className='border-border hover:bg-accent/40 flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-normal transition-colors has-data-checked:border-primary'
                >
                  <RadioGroupItem value={option.value} id={`theme-${option.value}`} className='sr-only' />
                  <Icon className='size-4' />
                  {option.label}
                </Label>
              );
            })}
          </RadioGroup>
          <p className='text-muted-foreground text-xs'>
            &quot;System&quot; follows your device&apos;s light/dark setting automatically.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
