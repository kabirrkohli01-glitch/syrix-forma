'use client';

/* SYRIX AI's own settings.
 *
 * Both controls save on change rather than behind a Save button. There are two
 * of them, each is instantly reversible, and neither has a half-filled state
 * worth protecting — a form that makes you press Save to change one toggle is
 * asking for a confirmation nobody needs.
 *
 * The state is optimistic and rolls back on failure, so the switch does not sit
 * still for a round trip and then jump. A failed save says so; it does not
 * leave the control showing something that is not true on the server.
 */

import React, { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Icons } from '@/components/icons';

import { updateAiSettings } from '../actions';
import { AI_LANGUAGES, type AiSettings } from '../utils/settings';

export function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const [settings, setSettings] = useState<AiSettings>(initial);
  const [pending, startTransition] = useTransition();

  const save = (patch: Partial<AiSettings>): void => {
    const previous = settings;
    setSettings({ ...settings, ...patch });

    startTransition(async () => {
      try {
        const saved = await updateAiSettings({
          language: patch.language,
          hubAccess: patch.hubAccess
        });
        setSettings(saved);
      } catch (error) {
        setSettings(previous);
        toast.error(error instanceof Error ? error.message : 'That could not be saved.');
      }
    });
  };

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Answer language</CardTitle>
          <CardDescription>
            The language SYRIX AI writes its answers in. It still reads sources in whatever language they
            are published in — UK immigration rules are published in English — and route names, form
            numbers and official page titles stay as the publisher writes them so you can still find them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={settings.language}
            onValueChange={(value) => save({ language: value as AiSettings['language'] })}
            className='grid gap-2 sm:grid-cols-2'
          >
            {AI_LANGUAGES.map((language) => (
              <Label
                key={language.code}
                htmlFor={`ai-language-${language.code}`}
                className='border-border hover:bg-accent/40 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-normal transition-colors has-data-checked:border-[color-mix(in_oklch,var(--ai-amber,oklch(0.78_0.13_68))_55%,transparent)]'
              >
                <RadioGroupItem value={language.code} id={`ai-language-${language.code}`} />
                <span className='flex min-w-0 flex-col'>
                  <span className='font-medium'>{language.label}</span>
                  <span className='text-muted-foreground text-xs'>{language.native}</span>
                </span>
                {language.code === 'en' ? (
                  <span className='text-muted-foreground ml-auto shrink-0 text-[0.7rem]'>Default</span>
                ) : null}
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Access to your work in the Hub</CardTitle>
          <CardDescription>
            Whether SYRIX AI may read your Hub records and offer to make changes to them.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='border-border flex items-start justify-between gap-4 rounded-lg border px-3 py-3'>
            <div className='min-w-0 space-y-1'>
              <p className='text-sm font-medium'>Let SYRIX AI read and act on the Hub</p>
              <p className='text-muted-foreground text-xs leading-relaxed'>
                On, it can answer questions about your tasks, calendar, clients, projects and colleagues —
                seeing only what your own permissions already allow — and can offer to create a task, a
                calendar event or a client note. Nothing is ever created without you approving a card that
                shows the exact details first.
              </p>
              <p className='text-muted-foreground text-xs leading-relaxed'>
                Off, it will not read a single Hub record and will not offer to change anything.
              </p>
            </div>
            <Switch
              checked={settings.hubAccess}
              disabled={pending}
              onCheckedChange={(checked) => save({ hubAccess: checked })}
              aria-label='Let SYRIX AI read and act on the Hub'
            />
          </div>

          {/* Said plainly, because the obvious worry about switching this off is
              that it quietly cripples the assistant, and it does not. */}
          <p className='text-muted-foreground flex items-start gap-2 text-xs'>
            <Icons.info className='mt-0.5 size-3.5 shrink-0' aria-hidden />
            <span>
              This does not affect research. With Hub access off, SYRIX AI still searches the web, reads
              official sources, answers with citations, and works through problems exactly as it does now —
              those never touch anything belonging to the organisation.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
