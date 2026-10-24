'use client';

/* A drafted email.
 *
 * IT DOES NOT SEND, AND THERE IS NO CODE PATH FROM HERE THAT COULD. The card is
 * a place to read a draft, adjust it and take it away — the sending is done by
 * a person, in their own mail client, where they can see the recipient one last
 * time. An assistant that can put a message in front of a client on its own is
 * a different feature with a different risk, and it is not this one.
 *
 * The body is editable in place because a draft is never right first time and
 * copying it out to fix a sentence, then having no way to put it back, makes the
 * card worse than a plain block of text. The edit is local to this tab: nothing
 * is posted back, nothing is stored, and a new chat takes it with everything
 * else.
 */

import React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';

import { emailToText, type EmailDraft } from '../utils/blocks';
import { CopyButton } from './copy-button';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline gap-2 text-xs'>
      <span className='text-muted-foreground w-14 shrink-0 font-medium'>{label}</span>
      <span className='text-foreground min-w-0 break-words'>{value}</span>
    </div>
  );
}

export function EmailCard({ draft }: { draft: EmailDraft }) {
  const [body, setBody] = React.useState(draft.body);
  /* Until somebody types, the card follows the draft — which is still arriving
     token by token while the answer streams. After they type, it stops: an
     incoming token must never overwrite a sentence the user just wrote. */
  const edited = React.useRef(false);

  React.useEffect(() => {
    if (!edited.current) setBody(draft.body);
  }, [draft.body]);

  const full = emailToText({ ...draft, body });

  return (
    <section className='border-border/70 bg-card overflow-hidden rounded-xl border'>
      <header className='border-border/60 bg-muted/40 flex items-center justify-between gap-2 border-b px-3 py-2'>
        <span className='text-muted-foreground flex items-center gap-1.5 text-[0.7rem] font-medium tracking-wide uppercase'>
          <Icons.mail className='size-3.5' aria-hidden />
          Draft email
        </span>
        <div className='flex items-center gap-0.5'>
          <CopyButton text={body} label='Copy body' />
          <CopyButton text={full} label='Copy all' />
        </div>
      </header>

      {draft.to || draft.cc || draft.subject ? (
        <div className='border-border/50 space-y-1 border-b px-3 py-2.5'>
          {draft.to ? <Field label='To' value={draft.to} /> : null}
          {draft.cc ? <Field label='Cc' value={draft.cc} /> : null}
          {draft.subject ? <Field label='Subject' value={draft.subject} /> : null}
        </div>
      ) : null}

      <Textarea
        value={body}
        onChange={(event) => {
          edited.current = true;
          setBody(event.target.value);
        }}
        aria-label='Email body'
        /* Grows with the draft rather than scrolling inside a fixed box: a
           twelve-line email read through a four-line window is not readable. */
        rows={Math.min(24, Math.max(6, body.split('\n').length + 1))}
        className='resize-y rounded-none border-0 bg-transparent text-sm leading-relaxed shadow-none focus-visible:ring-0'
      />

      <footer className='border-border/50 text-muted-foreground border-t px-3 py-1.5 text-[0.7rem]'>
        Not sent. Copy it into your mail client when you are happy with it.
      </footer>
    </section>
  );
}
