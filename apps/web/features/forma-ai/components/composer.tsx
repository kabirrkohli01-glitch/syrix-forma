'use client';

/* The input, and the files that go with it.
 *
 * FILES ARE READ IN THE BROWSER AND SENT WITH THE TURN. There is no upload
 * endpoint and no bucket, because an attachment here is part of a question and
 * the question is not stored anywhere either. Team Chat has real file storage
 * for files that are meant to persist; putting a client's report in that bucket
 * because somebody asked a question about it would be a different product
 * decision than the one anybody made.
 *
 * The size limit is enforced here AND on the server. Here so the user finds out
 * before waiting for an upload, and there because a limit that only exists in
 * the browser is not a limit.
 */

import React, { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

import type { PendingFile } from '../store/conversation';
import { DisclosureNote } from './disclosure-note';

/* Kept in step with `lib/ai/uploads/attachments.ts`. If these ever disagree the
   server wins, and the user sees a rejection after a wait instead of before —
   so they are stated in both places rather than guessed in one. */
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 4;

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.tsv,.json,.log';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      /* A data URL, of which only the payload is wanted. */
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return Icons.media;
  if (mime === 'application/pdf') return Icons.fileTypePdf;
  return Icons.post;
}

export function Composer({
  onSubmit,
  onStop,
  busy,
  seed,
  placeholder = 'Ask about a route, a threshold, a deadline…'
}: {
  onSubmit: (question: string, files: PendingFile[]) => void;
  onStop: () => void;
  busy: boolean;
  /**
   * Text put into the box from outside it — a suggested opener. Carries a
   * counter because picking the SAME suggestion twice must still land; a bare
   * string would compare equal and the second click would do nothing.
   *
   * It fills the box rather than sending. A suggestion is a starting point, and
   * sending it immediately takes away the chance to make it the actual question.
   */
  seed?: { text: string; at: number };
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [applied, setApplied] = useState(0);

  /* Adjusted during render rather than from an effect. Setting state in an
     effect renders the old value first and the new one a frame later, so the
     suggestion would visibly arrive in an already-empty box. Which seed has
     been taken is state rather than a ref because it decides what is rendered. */
  if (seed && seed.at !== applied) {
    setApplied(seed.at);
    setDraft(seed.text);
  }

  /* Focus is a DOM side effect and does belong in one. */
  React.useEffect(() => {
    if (!seed) return;
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    /* Caret at the end, so typing continues the sentence rather than landing in
       front of it — a programmatic value change otherwise leaves the caret at
       position zero. */
    box.setSelectionRange(seed.text.length, seed.text.length);
  }, [seed]);

  const accept = async (chosen: FileList | File[]): Promise<void> => {
    setProblem(null);
    const incoming = Array.from(chosen);

    if (files.length + incoming.length > MAX_FILES) {
      setProblem(`Attach at most ${MAX_FILES} files to one question.`);
      return;
    }

    const oversized = incoming.find((file) => file.size > MAX_BYTES);
    if (oversized) {
      setProblem(`${oversized.name} is ${sizeLabel(oversized.size)}. The limit is ${sizeLabel(MAX_BYTES)}.`);
      return;
    }

    try {
      const read = await Promise.all(
        incoming.map(async (file) => ({
          name: file.name,
          mime: file.type,
          size: file.size,
          data: await readAsBase64(file)
        }))
      );
      setFiles((current) => [...current, ...read]);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That file could not be read.');
    }
  };

  const submit = (): void => {
    if (busy) return;
    if (!draft.trim() && !files.length) return;
    onSubmit(draft, files);
    setDraft('');
    setFiles([]);
    setProblem(null);
  };

  return (
    <div className='space-y-1.5'>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length) void accept(event.dataTransfer.files);
        }}
        className={cn(
          'border-input bg-background rounded-2xl border px-2.5 py-2 transition-colors',
          'focus-within:border-[color-mix(in_oklch,var(--ai-amber)_50%,transparent)]',
          dragging && 'border-[color-mix(in_oklch,var(--ai-amber)_60%,transparent)] bg-foreground/5'
        )}
      >
        {files.length ? (
          <ul className='mb-2 flex flex-wrap gap-1.5'>
            {files.map((file, index) => {
              const Icon = iconFor(file.mime);
              return (
                <li
                  key={`${file.name}-${index}`}
                  className='bg-muted/70 text-foreground/80 flex items-center gap-1.5 rounded-lg py-1 pr-1 pl-2 text-xs'
                >
                  <Icon className='text-muted-foreground size-3.5 shrink-0' aria-hidden />
                  <span className='max-w-40 truncate'>{file.name}</span>
                  <span className='text-muted-foreground/70'>{sizeLabel(file.size)}</span>
                  <button
                    type='button'
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((_entry, i) => i !== index))}
                    className='text-muted-foreground hover:text-foreground hover:bg-background rounded p-0.5'
                  >
                    <Icons.close className='size-3' />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className='flex items-end gap-1.5'>
          <span
            aria-hidden
            className='mb-1.5 shrink-0 text-[color:var(--ai-amber)] opacity-70'
            style={{ lineHeight: 0 }}
          >
            <Icons.sparkles className='size-4' />
          </span>

          <Textarea
            ref={boxRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              /* A screenshot pasted straight from the clipboard is the most
                 common way an image arrives here — asking somebody to save it
                 to disk first so they can pick it from a dialog is a step that
                 exists only because nobody handled the paste. */
              const pasted = Array.from(event.clipboardData.files);
              if (pasted.length) {
                event.preventDefault();
                void accept(pasted);
              }
            }}
            onKeyDown={(event) => {
              /* Enter sends; Shift+Enter is a newline. A research question is
                 usually one line, and the ones that are not are pasted. */
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label='Ask SYRIX AI'
            className='max-h-40 min-h-0 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0'
          />

          <input
            ref={inputRef}
            type='file'
            multiple
            accept={ACCEPT}
            className='sr-only'
            onChange={(event) => {
              if (event.target.files?.length) void accept(event.target.files);
              /* Cleared so choosing the same file twice in a row still fires. */
              event.target.value = '';
            }}
          />

          <Button
            type='button'
            size='icon'
            variant='ghost'
            onClick={() => inputRef.current?.click()}
            disabled={busy || files.length >= MAX_FILES}
            aria-label='Attach a file'
            className='text-muted-foreground hover:text-foreground size-8 shrink-0'
          >
            <Icons.paperclip className='size-4' />
          </Button>

          {busy ? (
            <Button
              type='button'
              size='icon'
              variant='outline'
              onClick={onStop}
              aria-label='Stop'
              className='size-8 shrink-0 rounded-full'
            >
              <Icons.close className='size-4' />
            </Button>
          ) : (
            <Button
              type='button'
              size='icon'
              onClick={submit}
              disabled={!draft.trim() && !files.length}
              aria-label='Send'
              className='size-8 shrink-0 rounded-full border-0 text-[color:var(--ai-amber-ink)] disabled:opacity-40'
              style={{
                background: 'linear-gradient(140deg, var(--ai-amber-bright), var(--ai-amber))'
              }}
            >
              <Icons.send className='size-4' />
            </Button>
          )}
        </div>
      </div>

      <div className='flex items-center justify-between gap-3 px-1'>
        <DisclosureNote />
        {problem ? <p className='text-destructive text-[0.7rem]'>{problem}</p> : null}
      </div>
    </div>
  );
}
