/* What each person can change about the assistant.
 *
 * Two settings, both per employee. Neither is a permission: turning Hub access
 * off restricts what the assistant will do FOR YOU, and turning it back on
 * grants nothing you did not already have — every read still runs through the
 * context broker as you, and every write still needs an approval card and
 * passes the Hub's own checks. This is a preference about how you want to work,
 * not a control anybody's access depends on.
 */

export const AI_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'fa', label: 'Persian', native: 'فارسی' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' }
] as const;

export type AiLanguage = (typeof AI_LANGUAGES)[number]['code'];

export const DEFAULT_AI_LANGUAGE: AiLanguage = 'en';

export function isAiLanguage(value: unknown): value is AiLanguage {
  return typeof value === 'string' && AI_LANGUAGES.some((language) => language.code === value);
}

export function languageName(code: string): string {
  return AI_LANGUAGES.find((language) => language.code === code)?.label ?? 'English';
}

export interface AiSettings {
  language: AiLanguage;
  /** False keeps the assistant out of Hub records entirely. Research is untouched. */
  hubAccess: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { language: DEFAULT_AI_LANGUAGE, hubAccess: true };

/**
 * The instruction that makes the assistant answer in the chosen language.
 *
 * ONLY THE ANSWER IS TRANSLATED, and this is the part that needs saying
 * explicitly. UK immigration rules are published in English; searching for them
 * in Persian returns either nothing or somebody's blog. So retrieval, the
 * queries, and the reading all stay in the source language, and the answer is
 * written in the reader's. Proper nouns stay as published, because a route name
 * translated into Hindi cannot be looked up on GOV.UK by the person reading it.
 */
export function languageInstruction(code: string): string {
  if (code === 'en' || !isAiLanguage(code)) return '';

  const name = languageName(code);

  return [
    '',
    `ANSWER IN ${name.toUpperCase()}.`,
    `- Write your reply in ${name}. The person reading it has chosen that language.`,
    '- Search, read and reason in whatever language the sources are published in — do not translate a query, and do not refuse a source for being in English.',
    '- Keep proper nouns exactly as the publisher writes them: route names, form numbers, official page titles, organisation names and legal citations stay in their original language, so the reader can find them.',
    '- Keep figures, dates and currency in the form the source states them.'
  ].join('\n');
}
