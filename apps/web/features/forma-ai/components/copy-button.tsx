'use client';

/* Copying a block of an answer.
 *
 * IT COPIES THE SOURCE TEXT, NEVER THE RENDERED DOM. Every block the renderer
 * draws keeps the exact characters the model wrote, and that string is what
 * arrives here. A selection-based copy would pick up whatever the component
 * added for the reader — the language label above a code block, the "Not sent"
 * note on an email card, a source badge — and paste it into an editor or a mail
 * client as though it were part of the content. Reusable content has to come
 * back out byte for byte or the button is a trap.
 *
 * Confirmation is a state on the button itself rather than a toast. A toast for
 * an action whose result is already in the clipboard is an interruption that
 * tells the user nothing they cannot see.
 */

import React from 'react';

import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

const CONFIRM_MS = 1500;

export function CopyButton({
  text,
  label = 'Copy',
  className
}: {
  /** Exactly what lands on the clipboard. */
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Unmounting mid-confirmation is normal — a new chat clears the transcript
     while the timer is still pending — and setting state afterwards is a leak
     warning for no reason. */
  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* Denied permission, or an insecure origin. Saying nothing would leave
         the button looking like it worked, so the label reports the failure and
         the user can still select the text by hand. */
      setFailed(true);
      timer.current = setTimeout(() => setFailed(false), CONFIRM_MS);
      return;
    }

    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  };

  const Icon = copied ? Icons.check : Icons.copy;

  return (
    <button
      type='button'
      onClick={() => void copy()}
      /* Live, so the confirmation is announced rather than only shown. */
      aria-live='polite'
      className={cn(
        'text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[0.7rem] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
        copied && 'text-foreground',
        className
      )}
    >
      <Icon className='size-3.5' aria-hidden />
      {failed ? 'Press Ctrl+C' : copied ? 'Copied' : label}
    </button>
  );
}
