/* Talking, as opposed to researching, reading the Hub, or thinking.
 *
 * "hi" used to run the whole research pipeline: it planned a search, queried
 * GOV.UK, read two pages, checked the answer's figures against them, and
 * replied "Hello. How can I assist you with UK immigration matters today?" —
 * attaching the Student visa guidance as a source. Twelve seconds, two
 * citations, and a process panel, for a greeting.
 *
 * Deciding that a turn is small talk now belongs to `route.ts`, which decides
 * between several paths rather than two. What is left here is the reply itself.
 *
 * THE VOICE. The research answer is precise because it has to be. That
 * precision reads as coldness when it is aimed at "hi", and an assistant that
 * greets a colleague like a form letter is one people stop opening. The
 * register is a capable colleague at the next desk: warm, brief, and specific
 * about what it can actually do — not a chatbot performing enthusiasm.
 *
 * "Professional" is the constraint, not "formal". Contractions and a bit of
 * personality are welcome; exclamation marks, emoji and "Certainly!" are not.
 */

import { chat, StoppedError } from '../gateway/client';

const CONVERSATION_RULES = [
  'This message is small talk, not a question to research, so just talk. Do not search, do not cite ' +
    'anything, and do not recite a list of what you can do unless they actually asked.',
  '',
  'HOW YOU SOUND:',
  '- Like a capable colleague at the next desk. Warm, direct, human.',
  '- Use contractions. Vary how you open — never the same greeting twice in a conversation.',
  '- One or two sentences. Three at the very most. Brevity is warmth here; a paragraph is not.',
  /* The formatting ban is stated on this path too, not only on the answering
     ones. Told elsewhere that headings and bullets are available, the model has
     replied to "thanks" with a bulleted list of what it can do next. */
  '- Plain sentences. No headings, no bullet points, no numbered lists, no tables, no code blocks.',
  '- No exclamation marks, no emoji, no "Certainly", no "I hope this message finds you well", and no ' +
    'restating what the user just said back to them.',
  '- Never call yourself an AI language model or explain your architecture.',
  '',
  'If they greet you, greet them back and invite the actual question without being pushy about it. If ' +
    'they thank you, accept it briefly and stop — do not manufacture a follow-up.'
].join('\n');

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Answer a conversational turn.
 *
 * Runs on the fast tier with no retrieval at all, so it returns in about a
 * second rather than the ten a research round takes.
 */
export async function converse(
  question: string,
  options: {
    /** Who the assistant is, from `lib/ai/knowledge/identity.ts`. */
    identity: string;
    history?: ConversationTurn[];
    signal?: AbortSignal;
    onToken?: (full: string, delta: string) => void;
  }
): Promise<{ text: string; provider: string; model: string }> {
  /* Recent turns only. This exists so the assistant does not greet someone who
     has already said hello, which needs the last exchange and nothing older. */
  const history = (options.history ?? []).slice(-4);

  try {
    const result = await chat({
      tier: 'spark',
      /* Small talk carries no Hub record, but the conversation it sits in may
         have, and the history is included below — so this is treated as
         Hub-bearing and stays on providers that do not retain input. */
      carriesHubContext: true,
      temperature: 0.7,
      /* Tight on purpose. This model reasons inside the completion, and given
         room it will spend sixteen seconds deciding how to say hello — the same
         gateway answers a one-word ping in under two. A greeting needs perhaps
         forty tokens, so the ceiling caps the deliberation rather than the
         reply. The fallback below covers the case where it caps too hard. */
      maxTokens: 360,
      signal: options.signal,
      onToken: options.onToken,
      messages: [
        { role: 'system', content: `${options.identity}\n\n${CONVERSATION_RULES}` },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: question }
      ]
    });

    const text = result.text.trim();
    if (text) return { text, provider: result.provider, model: result.model };
  } catch (error) {
    if (error instanceof StoppedError) throw error;
  }

  /* Failing on "hi" would be absurd, so small talk never errors. */
  return { text: fallbackReply(question, history), provider: 'none', model: 'fallback' };
}

/* Written out rather than generated, because this path has to work when the
 * model will not — and it runs more often than it should: the gateway's fast
 * lane returns an empty completion for some of these however much room it is
 * given.
 *
 * VARIED, AND NEVER THE LINE IT JUST USED. A fixed string per category is the
 * exact robotic register this whole path exists to get away from: say "thanks"
 * twice and a single canned reply announces itself as canned. */
const FALLBACKS = {
  pleasantry: ['Any time.', 'No problem.', 'Glad it helped.', 'Sure thing.'],
  howAreYou: ['Good, thanks. What are you working on?', 'All fine. What do you need?', "Not bad. What's the question?"],
  greeting: [
    'Hello. What can I look into for you?',
    'Hey. What do you need checked?',
    'Morning. What are we looking at?',
    'Hi. What can I research for you?'
  ]
} as const;

const PLEASANTRY =
  /^(thanks?|thank you|ta|cheers|nice one|great|perfect|ok|okay|k|cool|got it|understood|no worries|np|bye|goodbye|see ya|later|night|lol|haha)[!.]*$/i;

const HOW_ARE_YOU = /^(how are you( doing)?|you (ok|okay|alright|good)|hows it going|how's it going|whats up|what's up)[?!.]*$/i;

function pick(options: readonly string[], history: ConversationTurn[]): string {
  const lastReply = [...history].reverse().find((turn) => turn.role === 'assistant')?.content.trim();
  const fresh = options.filter((option) => option !== lastReply);
  const pool = fresh.length ? fresh : options;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function fallbackReply(question: string, history: ConversationTurn[]): string {
  const text = question.trim().toLowerCase().replace(/[.!?]+$/, '');

  if (PLEASANTRY.test(text)) return pick(FALLBACKS.pleasantry, history);
  if (HOW_ARE_YOU.test(text)) return pick(FALLBACKS.howAreYou, history);
  return pick(FALLBACKS.greeting, history);
}
