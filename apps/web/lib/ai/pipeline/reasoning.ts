/* Catching the model's own reasoning on its way out of the answer.
 *
 * The models behind this gateway think inside the completion. "We need to check
 * whether the absence rule applies here", "Let's aim for about 150 words",
 * "Now produce the answer in markdown" — all of it arrives in the same stream as
 * the answer, and `guards.ts` strips it before anybody reads it.
 *
 * Stripping it was right. Throwing it away was waste. It is the only honest
 * account that exists of what the model is doing while the user waits, and the
 * alternative — a panel that invents plausible-looking steps — is the thing the
 * process panel exists specifically not to be.
 *
 * THE INVARIANT THAT MAKES THIS SAFE. A line is emitted as reasoning only if
 * the guards would remove it from the answer, and the same two predicates decide
 * both. So the panel can never show a sentence that also appears in the answer,
 * and — more importantly — capturing a line here can never delete it from the
 * answer, because this class does not touch the answer at all. It observes the
 * stream; the guards do the removing, afterwards, as they always did.
 *
 * Line-buffered rather than token-buffered: a partial line cannot be classified,
 * and emitting half a sentence and then reclassifying it is worse than a short
 * wait.
 */

import { isNarration, looksLikeAnswer } from '../guards/guards';

/** How much of one line is worth showing. Longer than this is prose, not a step. */
const MAX_LINE = 300;

export class ReasoningSplitter {
  private buffer = '';
  /** Set once the answer proper has started. Before it, everything is preamble. */
  private answerStarted = false;
  private lines = 0;

  /* A ceiling, because a model that loops narrates the loop. Twenty lines is
     more than any real answer has produced and still bounded. */
  private static readonly MAX_LINES = 20;

  constructor(private readonly onReasoning?: (text: string) => void) {}

  /** Feed one streamed delta. Safe to call with no listener attached. */
  push(delta: string): void {
    if (!this.onReasoning) return;

    this.buffer += delta;

    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;

      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.consider(line);
    }
  }

  /**
   * Flush what is left.
   *
   * The final line of a completion has no trailing newline, and on a short
   * reply the whole thing can be that line. Considered rather than dropped —
   * but only as preamble, since an unterminated last line is far more likely to
   * be the end of the answer than a note about it.
   */
  finish(): void {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest && !this.answerStarted) this.consider(rest);
  }

  private consider(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) return;
    if (this.lines >= ReasoningSplitter.MAX_LINES) return;

    /* Once a line looks like the start of a real answer, the preamble is over
       and only explicit narration counts from then on. This mirrors
       `stripNarration` finding its anchor and `dropInlineNarration` running on
       everything after it — the two guards, in the order they run. */
    if (!this.answerStarted && looksLikeAnswer(line)) {
      this.answerStarted = true;
      return;
    }

    const isReasoning = this.answerStarted ? isNarration(line) : true;
    if (!isReasoning) return;

    this.lines++;
    this.onReasoning?.(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line);
  }
}
