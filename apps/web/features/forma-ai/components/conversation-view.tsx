'use client';

/* The conversation surface, mounted identically by the side panel and the full
   tab. Both read the same store, so switching between them is a change of frame
   and never of state.

   WHAT A TURN SHOWS DEPENDS ON WHAT ACTUALLY HAPPENED. The route the pipeline
   took is on the turn, and the apparatus follows it: a greeting gets no
   thinking panel and no sources, because there was nothing to think about and
   nothing was retrieved. A source list under a greeting implies the greeting
   came from those sources, which is both untrue and faintly absurd — it is the
   exact failure this whole rework started from. */

import React, { useEffect, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

import { useConversation, type Citation, type Mode, type PendingFile, type Turn } from '../store/conversation';
import { AnswerText } from './answer-text';
import { ApprovalCard, ApprovalOutcome } from './approval-card';
import { ArcField } from './arc-field';
import { Capabilities, Suggestions } from './capabilities';
import { Composer } from './composer';
import { FormaAiMark } from './forma-ai-mark';
import { CouncilPanel } from './council-panel';
import { ThinkingPanel, ThinkingStatus } from './thinking-panel';

/* THE THREE MODES, DESCRIBED BY WHAT THEY ACTUALLY DO DIFFERENTLY.
 *
 * The old hints said "one fast pass", "reads several sources" and "deepest
 * research pass", which are three ways of saying "more". They gave nobody a
 * reason to pick one. What actually differs is the number of searches, how many
 * pages are read, and — for Zenith alone — whether the question is split across
 * specialists and the result checked back against the evidence before it is
 * shown. That is worth knowing, and it is what these say. */
const MODES: { id: Mode; label: string; icon: keyof typeof Icons; hint: string }[] = [
  {
    id: 'spark',
    label: 'Spark',
    icon: 'automation',
    hint: 'One search, two pages, one pass. For a fact you half-remember and want confirmed. Fastest, and the shallowest — it will miss a caveat that is on page three.'
  },
  {
    id: 'auto',
    label: 'Auto',
    icon: 'adjustments',
    hint: 'Three searches, five pages read properly, one considered answer. The default, and the right choice for almost every real question.'
  },
  {
    id: 'zenith',
    label: 'Zenith',
    icon: 'sparkles',
    hint: 'Four searches and eight pages, then a council: specialists each take a part of the question, a chief writes from their findings, and a reviewer checks the result against the evidence and sends it back if it does not hold. Slow — minutes, not seconds. For a question with several parts, or one you are going to act on.'
  }
];

/* Authority is the single most important thing about a source here, so it is
   shown as a word rather than encoded in a colour alone. */
const AUTHORITY_LABEL: Record<string, string> = {
  official: 'Official',
  legal: 'Legislation',
  reputable: 'Reputable',
  unverified: 'Unverified'
};

export function ModeSwitcher({
  mode,
  onChange,
  disabled
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  disabled: boolean;
}) {
  return (
    <div
      className='bg-muted/50 inline-flex rounded-full p-0.5'
      role='radiogroup'
      aria-label='How deeply to research'
    >
      {MODES.map((option) => {
        const Icon = Icons[option.icon];
        const active = mode === option.id;

        return (
          <Tooltip key={option.id}>
            <TooltipTrigger
              render={
                <button
                  type='button'
                  role='radio'
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => onChange(option.id)}
                  className={cn(
                    'focus-visible:ring-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50',
                    active
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-[color-mix(in_oklch,var(--ai-amber)_45%,transparent)]'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon
                    className={cn('size-3.5', active && 'text-[color:var(--ai-amber)]')}
                    aria-hidden
                  />
                  {option.label}
                </button>
              }
            />
            <TooltipContent side='bottom' className='max-w-72 text-left'>
              {option.hint}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;

  return (
    <div className='space-y-1.5'>
      <p className='text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase'>Sources</p>
      <ul className='space-y-1.5'>
        {citations.map((citation) => (
          <li key={citation.url} className='flex items-start gap-2 text-xs'>
            <Badge
              variant={citation.authority === 'official' || citation.authority === 'legal' ? 'default' : 'secondary'}
              className='mt-px shrink-0 px-1.5 py-0 text-[0.65rem] font-medium'
            >
              {AUTHORITY_LABEL[citation.authority] ?? citation.authority}
            </Badge>
            <a
              href={citation.url}
              target='_blank'
              rel='noopener noreferrer nofollow'
              className='text-foreground/80 hover:text-foreground min-w-0 underline decoration-dotted underline-offset-2'
            >
              {citation.label}
            </a>
            {citation.publishedAt ? (
              <span className='text-muted-foreground shrink-0'>
                {new Date(citation.publishedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* One quiet line, and only where it says something.
 *
 * IT USED TO BE A STRAP UNDER EVERY ANSWER. "Auto · 38.9s · Forma gateway ·
 * research, not advice — review before it reaches a client" ran under a
 * two-sentence reply as readily as under a page of analysis, and a caption
 * that appears every single time is one nobody reads by the third turn — which
 * takes the one caveat that matters down with it.
 *
 * What survives is the part that changes per turn: how long it took, and, where
 * it is genuinely true, whether the answer stands on sources. Nothing here
 * names the machinery it ran on. The old line printed a provider, which
 * described the assistant to its user as a piece of plumbing. */
function TurnFooter({ turn }: { turn: Turn }) {
  /* A draft says what it is on the card itself, and a card with a caption under
     it reads as a sent message with a receipt. */
  if (turn.route === 'chat' || turn.route === 'action' || turn.route === 'draft') return null;

  const mode = turn.mode === 'spark' ? 'Spark' : turn.mode === 'zenith' ? 'Zenith' : 'Auto';
  const timing = turn.ms ? `${(turn.ms / 1000).toFixed(1)}s` : '';

  const note =
    turn.route === 'research'
      ? 'research, not advice'
      : turn.route === 'reason'
        ? 'reasoned, not sourced'
        : turn.route === 'hub'
          ? 'only records you can already see'
          : '';

  return (
    <p className='text-muted-foreground/70 text-[0.7rem]'>
      {[turn.route === 'self' ? null : mode, timing, note].filter(Boolean).join(' · ')}
    </p>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const { decide } = useConversation();
  const running = turn.status === 'running';
  /* The first stage if one has arrived, and otherwise when the question was
     sent — recorded on the turn, never read from the clock mid-render. */
  const startedAt = turn.stages[0]?.at ?? turn.startedAt;

  /* Small talk gets none of the apparatus. */
  const showsThinking = turn.route !== 'chat' && (turn.stages.length > 0 || running);

  return (
    <article className='space-y-3'>
      <div className='flex flex-col items-end gap-1.5'>
        <p className='bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap'>
          {turn.question}
        </p>
        {turn.attachments.length ? (
          <ul className='flex max-w-[85%] flex-wrap justify-end gap-1'>
            {turn.attachments.map((file) => (
              <li
                key={file.name}
                className='bg-muted text-muted-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem]'
                title={file.note ?? undefined}
              >
                {file.kind === 'image' ? (
                  <Icons.media className='size-3' aria-hidden />
                ) : file.kind === 'pdf' ? (
                  <Icons.fileTypePdf className='size-3' aria-hidden />
                ) : (
                  <Icons.post className='size-3' aria-hidden />
                )}
                {file.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {showsThinking ? (
        <>
          <ThinkingPanel
            stages={turn.stages}
            reasoning={turn.reasoning}
            running={running}
            startedAt={startedAt}
          />
          <ThinkingStatus stages={turn.stages} running={running} />
        </>
      ) : null}

      {turn.status === 'error' ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2.5 text-sm'>
          {turn.error}
        </div>
      ) : null}

      {turn.status === 'stopped' && !turn.answer ? (
        <p className='text-muted-foreground text-sm italic'>Stopped.</p>
      ) : null}

      {turn.answer ? (
        <div className='space-y-4'>
          <AnswerText text={turn.answer} />

          {turn.proposal ? (
            <ApprovalCard
              proposal={turn.proposal}
              onDecide={(verdict) => void decide(turn.id, turn.proposal!.id, verdict)}
            />
          ) : null}

          {turn.proposalOutcome ? <ApprovalOutcome outcome={turn.proposalOutcome} /> : null}

          {turn.unsupportedFigures.length ? (
            <div className='rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs'>
              <p className='font-medium text-amber-700 dark:text-amber-500'>
                Figures with no source: {turn.unsupportedFigures.join(', ')}
              </p>
              <p className='text-muted-foreground mt-1'>
                Verify these against the published rule before relying on them.
              </p>
            </div>
          ) : null}

          {turn.suspiciousSources.length ? (
            <div className='rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs'>
              <p className='font-medium text-amber-700 dark:text-amber-500'>
                {turn.suspiciousSources.length} source(s) contained text addressed to an assistant
              </p>
              <p className='text-muted-foreground mt-1'>
                {turn.suspiciousSources.map((source) => source.label).join(', ')}
              </p>
            </div>
          ) : null}

          {turn.status === 'done' ? (
            <>
              {turn.council ? <CouncilPanel council={turn.council} /> : null}
              {turn.route === 'research' ? <Sources citations={turn.citations} /> : null}
              {/* Only where something was actually read. A draft written from a
                  published figure names where the figure came from; one written
                  from what the user told it has nothing to list. */}
              {(turn.route === 'self' || turn.route === 'draft') && turn.citations.length ? (
                <Sources citations={turn.citations} />
              ) : null}
              {turn.hubReads.length ? (
                <p className='text-muted-foreground text-[0.7rem]'>
                  Read: {turn.hubReads.map((read) => `${read.label}`).join(' · ')}
                </p>
              ) : null}
              <TurnFooter turn={turn} />
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/* The hero above the composer on an empty screen. Deliberately small: it sits
   directly on top of the input now rather than in the middle of the window, and
   anything taller pushes the thing people came here to use off-centre. */
function Hero({ compact }: { compact?: boolean }) {
  return (
    <div className='flex flex-col items-center gap-3 px-6 pb-6 text-center'>
      <div className='flex flex-col items-center gap-3'>
        <FormaAiMark size={compact ? 48 : 64} />

        <div className='space-y-1.5'>
          <h2 className={cn('font-semibold tracking-tight', compact ? 'text-lg' : 'text-3xl')}>
            What can I <span className='forma-ai-gradient-text'>look into</span> for you?
          </h2>
          {/* Attribution, not a feature list — what it can do is said properly
              below the composer, where there is room to say it accurately. */}
          <p className={cn('text-muted-foreground', compact ? 'text-[0.7rem]' : 'text-sm')}>
            SYRIX AI — made by Kabirr Kohli, powered by <span className='forma-ai-gradient-text font-medium'>SYRIX</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function ConversationView({
  className,
  compact,
  showModeBar = true
}: {
  className?: string;
  /** The side panel: narrower, so the hero loses its chips and drops a size. */
  compact?: boolean;
  /** The full tab draws its own mode bar above the panel, matching the reference. */
  showModeBar?: boolean;
}) {
  const { turns, mode, busy, setMode, ask, stop, newChat } = useConversation();
  /* A suggested opener on its way into the composer. Carries the time it was
     picked so choosing the same one twice still registers. */
  const [seed, setSeed] = React.useState<{ text: string; at: number } | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Whether to keep following the answer down. Set by the user's own scrolling,
     not recomputed from the geometry on every frame — see below. */
  const stickRef = useRef(true);

  /* WHY THIS IS NOT `scrollIntoView({ behavior: 'smooth' })`.
   *
   * It was, and it made the transcript impossible to scroll. A streamed answer
   * updates state on every token — dozens of times a second — and each update
   * started a NEW smooth scroll before the previous one had finished. The
   * result is an animation that never lands, that re-targets continuously, and
   * that overrides any scroll the user attempts, so dragging up gets yanked
   * straight back down. It also scrolls every scrollable ancestor, so the page
   * itself moved too.
   *
   * Instead: the container's own `scrollTop` is set directly, which is instant
   * and idempotent, and it only happens while the user is at the bottom. The
   * decision to follow is made from the SCROLL EVENT rather than from the
   * geometry at render time — during streaming the content grows underneath the
   * viewport, so measuring the distance from the bottom mid-stream reports
   * "they scrolled away" when nobody moved. */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = (): void => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      /* Generous: a couple of lines of slack so a trackpad's inertia settling a
         few pixels short does not read as a deliberate scroll away. */
      stickRef.current = distance < 80;
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !stickRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [turns]);

  /* A new question always brings the view back down, whatever the user was
     reading — they just asked, so the answer is what they want to see. Keyed on
     the count alone so it does not re-fire on every token of the same turn. */
  useEffect(() => {
    stickRef.current = true;
  }, [turns.length]);

  const submit = (question: string, files: PendingFile[]): void => {
    ask(question, files);
  };

  const started = turns.length > 0;

  return (
    <div
      className={cn(
        'forma-ai flex h-full min-h-0 flex-col',
        !started && 'relative overflow-hidden',
        className
      )}
    >
      {/* Behind the whole empty screen rather than behind the hero alone: the
          field is absolutely positioned to its nearest positioned ancestor, and
          scoping it to the hero would draw a band across the middle of the
          window instead of a backdrop. Negative z so the flow content above it
          paints normally. */}
      {started ? null : <ArcField className='-z-10' />}

      {showModeBar ? (
        <>
          <div className='flex items-center justify-between gap-2 px-4 py-2.5'>
            <ModeSwitcher mode={mode} onChange={setMode} disabled={busy} />
            <Button
              variant='ghost'
              size='sm'
              onClick={newChat}
              disabled={!turns.length}
              className='text-muted-foreground hover:text-foreground text-xs'
            >
              New chat
            </Button>
          </div>
          <Separator />
        </>
      ) : null}

      {/* THE COMPOSER STARTS IN THE MIDDLE AND MOVES TO THE BOTTOM.
       *
       * An empty screen with its input pinned to the floor and a hero floating
       * above it reads as a page that is waiting for something else to happen.
       * Putting the input where the eye already is says what to do, which is the
       * pattern every assistant people already use has settled on.
       *
       * It is the SAME ELEMENT in both states, not two rendered conditionally.
       * Two would mean React unmounting one and mounting the other on the first
       * question, losing the box's focus and any file already attached to a
       * question that has not been asked yet. Instead the regions around it
       * change: above it grows and scrolls, below it collapses. */}
      <div
        ref={scrollRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          started ? 'overflow-y-auto' : 'justify-end overflow-hidden'
        )}
      >
        {started ? (
          <div className='mx-auto w-full max-w-3xl space-y-8 px-1 py-5'>
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
          </div>
        ) : (
          <Hero compact={compact} />
        )}
      </div>

      {/* No top border and no panel around it: the composer's own border is the
          only edge this screen needs, and a second rule above it re-created the
          box the canvas layout exists to remove. */}
      <div className={cn('px-1 pb-1', started ? 'pt-3' : 'pt-0')}>
        <div className='mx-auto max-w-3xl'>
          <Composer onSubmit={submit} onStop={stop} busy={busy} seed={seed} />
        </div>
      </div>

      {/* The other half of the centring, and where the screen says what it can
          do. Collapses to nothing the moment a conversation exists. */}
      {started ? null : (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-4 pb-6'>
            <Suggestions compact={compact} onPick={(text) => setSeed({ text, at: Date.now() })} />
            <Capabilities compact={compact} />
          </div>
        </div>
      )}
    </div>
  );
}
