import { describe, expect, it } from 'vitest';

import { looksLikeNewsQuestion, parseFeed } from '@/lib/ai/research/news';

const FEED = { name: 'BBC News (Technology)', authority: 'reputable' as const };

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>BBC News</title>
  <item>
    <title><![CDATA[Anthropic blocks attempt to misuse its models]]></title>
    <link>https://www.bbc.co.uk/news/articles/abc123</link>
    <description>The company said it had detected and stopped the activity.</description>
    <pubDate>Thu, 11 Sep 2026 08:15:25 GMT</pubDate>
  </item>
  <item>
    <title>An item with no date at all</title>
    <link>https://www.bbc.co.uk/news/articles/def456</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://www.gov.uk/search/news-and-communications.atom"/>
  <entry>
    <title>Changes to the Immigration Rules</title>
    <link rel="alternate" href="https://www.gov.uk/government/news/changes-to-the-immigration-rules"/>
    <updated>2026-09-10T09:30:00+01:00</updated>
    <summary>A statement of changes was laid before Parliament.</summary>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('reads an RSS item, its link and its RFC 822 date', () => {
    const [item] = parseFeed(RSS, FEED);

    expect(item).toEqual({
      url: 'https://www.bbc.co.uk/news/articles/abc123',
      title: 'Anthropic blocks attempt to misuse its models',
      snippet: 'The company said it had detected and stopped the activity.',
      engine: 'BBC News (Technology)',
      authority: 'reputable',
      publishedAt: '2026-09-11T08:15:25.000Z'
    });
  });

  /* An undated story cannot answer a question about the last 24 hours, and
     carrying one into the dossier invites the model to date it itself. */
  it('drops an item with no date rather than assuming it is new', () => {
    expect(parseFeed(RSS, FEED)).toHaveLength(1);
  });

  it('reads an Atom entry and takes the article link, not the feed link', () => {
    const [item] = parseFeed(ATOM, { name: 'GOV.UK', authority: 'official' });

    expect(item?.url).toBe('https://www.gov.uk/government/news/changes-to-the-immigration-rules');
    expect(item?.publishedAt).toBe('2026-09-10T08:30:00.000Z');
    expect(item?.authority).toBe('official');
  });

  it('survives a body that is not a feed at all', () => {
    expect(parseFeed('<html><body>Not a feed</body></html>', FEED)).toEqual([]);
  });
});

describe('looksLikeNewsQuestion', () => {
  it.each([
    'what are the 3 biggest AI industry news stories from the last 24 hours',
    'any recent changes to the immigration rules',
    'what happened today',
    'has anything been announced this week'
  ])('treats %j as a question about recent events', (question) => {
    expect(looksLikeNewsQuestion(question)).toBe(true);
  });

  /* A rule has not changed because a newspaper wrote about it. Mixing a
     fortnight of headlines into a question about a published threshold buries
     the page that states it. */
  it.each([
    'what is the skilled worker salary threshold',
    'how long does an ILR application take',
    'can my client switch from a student visa'
  ])('leaves %j to the ordinary lanes', (question) => {
    expect(looksLikeNewsQuestion(question)).toBe(false);
  });
});
