import { describe, expect, it } from 'vitest';

import { groundIfDomain, keywordQuery, ruleRoute, rulePhraseQuery } from '../../lib/ai/pipeline/route';

/* `ruleRoute` is the half of routing that runs in code. It returns a route when
   it is sure and null when it is not — null is not a failure, it is the turn
   being handed to the model router. So these tests assert two different things:
   which turns must be settled without a model call, and which must never be
   settled without one. */
describe('ruleRoute', () => {
  /* The failure this exists for: "hi" ran the whole research pipeline, searched
     GOV.UK, read two pages, and returned a greeting with the Student visa
     guidance attached as its source. */
  it.each(['hi', 'Hi', 'hii', 'hey', 'hello', 'Hello!', 'yo', 'good morning', 'morning', 'how are you?'])(
    'answers %j as conversation',
    (text) => {
      expect(ruleRoute(text)).toBe('chat');
    }
  );

  it.each(['thanks', 'thank you', 'cheers', 'ok', 'got it', 'perfect', 'bye'])(
    'answers %j as conversation',
    (text) => {
      expect(ruleRoute(text)).toBe('chat');
    }
  );

  /* The second failure this exists for: asked what it was, the assistant
     searched the web and answered about immigration law. */
  it.each([
    'who are you',
    'what can you do?',
    'how do you work',
    'who built you',
    'what are you powered by',
    'do you store what I ask you',
    'what does forma do',
    'tell me about the company',
    'help'
  ])('answers %j from what it knows about itself', (text) => {
    expect(ruleRoute(text)).toBe('self');
  });

  it.each([
    'what are my tasks',
    "what's on my calendar",
    'who works here',
    'who is on my team',
    "what's due this week",
    'how many clients do we have',
    'which clients am I on'
  ])('answers %j from Hub records', (text) => {
    expect(ruleRoute(text)).toBe('hub');
  });

  /* "My client" is how a consultant opens an immigration question, not a
     request to read the Clients table. It used to route to a database read,
     which would have answered a question about absence limits with a list of
     client rows. */
  it.each([
    'my client has been here 9 years — does she qualify?',
    'my client wants to bring their partner over',
    "our client's application was refused, what now"
  ])('does not read the Clients table for %j', (text) => {
    expect(ruleRoute(text)).not.toBe('hub');
  });

  it.each([
    'add a task to chase the landlord reference',
    'create a calendar event for Thursday at 10',
    'schedule a review meeting next Tuesday'
  ])('treats %j as something to propose', (text) => {
    expect(ruleRoute(text)).toBe('action');
  });

  /* An instruction and a question about an instruction are different turns.
     "How do I add a task" wants an answer, not an approval card. */
  it('does not propose an action for a question about one', () => {
    expect(ruleRoute('how do I add a task')).not.toBe('action');
    expect(ruleRoute('can I create a recurring task')).not.toBe('action');
  });

  /* The asymmetry that governs the whole router: a greeting sent to research
     wastes ten seconds, while a real question sent anywhere else produces a
     confident, sourceless answer about somebody's immigration status. Anything
     carrying a domain term is refused by the rules and handed to the model. */
  it.each([
    'What is the Skilled Worker minimum salary?',
    'ILR fee?',
    'spouse visa requirements',
    'How long does a visa take',
    'what documents does a dependant need',
    'hi, what is the ILR fee',
    'hello can you tell me about the spouse visa'
  ])('refuses to settle %j in code', (text) => {
    expect(ruleRoute(text)).toBeNull();
  });

  /* A greeting attached to a real question is a real question — and the
     domain-term check is what makes that true regardless of how it opens. */
  it('does not treat a greeting with a question attached as small talk', () => {
    expect(ruleRoute('hi, what is the ILR fee')).not.toBe('chat');
  });

  /* "help" alone is someone asking what this does; "help with a visa" is not. */
  it('separates a bare request for help from a request for help with something', () => {
    expect(ruleRoute('help')).toBe('self');
    expect(ruleRoute('help with a visa application')).toBeNull();
  });

  /* Long turns are handed on even when they contain a phrase the rules
     recognise, because a paragraph mentioning "my tasks" in passing is not a
     request to list them. */
  it('hands a long message to the model router', () => {
    expect(
      ruleRoute(
        'I have a situation I would like you to look into for one of the people we act for, and it ' +
          'touches my tasks as well as what we told them last month, so I need you to weigh it all up'
      )
    ).toBeNull();
  });
});

/* The model router would not stop sending these to the web, three times
   running, and both post-hoc relevance guards let them through — search returns
   real official pages that share ordinary words like "fee" and "hours" with the
   question. A billable-hours sum came back citing "Visit the UK as a Standard
   Visitor" and "Graduate visa". */
describe('ruleRoute — arithmetic the question carries its own numbers for', () => {
  it.each([
    'Our team of 6 consultants each bill 7 hours a day, 5 days a week, at 78% utilisation, for 46 working weeks a year. Work out how many extra billable hours a 25% increase needs.',
    'If we bill 7 hours a day at 80% utilisation over 46 weeks, how many hours is that a year?',
    'We have 4 staff on 35 hours a week and want to calculate the cost at £45 an hour over 12 months'
  ])('works %#. out rather than searching for it', (question) => {
    expect(ruleRoute(question)).toBe('reason');
  });

  /* "fee income" is the firm's own revenue. The domain net contains "fee" so
     that "what's the ILR fee" reaches research without naming a route, and that
     same word sent a billable-hours sum to GOV.UK. */
  it('does not mistake the firm\'s fee income for a Home Office fee', () => {
    expect(
      ruleRoute('We want to grow fee income by 25% next year across 6 consultants billing 7 hours a day')
    ).toBe('reason');
  });

  /* The guard that makes the rule above safe: a question about a published rule
     keeps its sources no matter how many numbers it contains. */
  it.each([
    'My client has been here 9 years and 3 months with 210 days absent in one 12-month period — how many days can she be absent and still qualify?',
    'What is the 5-year ILR salary threshold and how much is the fee for 2 dependants?',
    'Calculate whether 180 days absence over 5 years breaks continuous residence for a spouse visa'
  ])('leaves %#. to research because it turns on a published rule', (question) => {
    expect(ruleRoute(question)).toBeNull();
  });

  /* One number is a reference, not a calculation. */
  it('does not treat a passing number as a sum to work out', () => {
    expect(ruleRoute('how much does it cost')).not.toBe('reason');
    expect(ruleRoute('what does section 3 say')).not.toBe('reason');
  });
});

describe('ruleRoute — analysis of a situation the question describes', () => {
  /* The failure this exists for: 48 seconds spent searching, a family-visa page
     and a CRM article returned, and then a refusal to rank risks the asker had
     just described in full. */
  it('thinks through a risk assessment rather than searching for one', () => {
    expect(
      ruleRoute(
        'A UK company wants to deploy an AI system that handles customer support, processes personal ' +
          'data, and makes recommendations about financial products. Identify the major technical, ' +
          'privacy, cybersecurity and ethical risks. Then rank the risks from highest to lowest and ' +
          'explain how you would mitigate each one.'
      )
    ).toBe('reason');
  });

  it('thinks through a commercial trade-off the question sets out', () => {
    expect(
      ruleRoute(
        'We are choosing between hiring two more junior consultants or one senior one, on the same ' +
          'budget, with a pipeline that is growing but lumpy. Weigh up the options and say which you ' +
          'would take and why.'
      )
    ).toBe('reason');
  });

  /* The guards. A named route, a question about what is permitted, or a short
     question that is really a lookup all stay on the research path. */
  it.each([
    'Identify the risks of applying for ILR now rather than waiting six months, and rank them for a client on a Skilled Worker visa who has been absent 190 days',
    'Set out the requirements an applicant must meet and rank which are hardest to evidence for a spouse application',
    'rank the risks'
  ])('leaves %#. to research', (question) => {
    expect(ruleRoute(question)).not.toBe('reason');
  });
});

describe('ruleRoute — a request for code', () => {
  /* The failure this exists for: three lines of pandas, cited to "Polars
     (software)" and "Muse (headband)". No published page holds the snippet
     somebody wants, and a model handed irrelevant sources will use them. */
  it.each([
    'Give me the Python to read a CSV and print the first five rows',
    'write a SQL query that counts rows per month',
    'show me the regex for a UK postcode',
    'how do I write a bash script to rename files'
  ])('works %#. out rather than searching for it', (question) => {
    expect(ruleRoute(question)).toBe('reason');
  });

  /* A share code, an occupation code and a CoS reference are all "codes" here,
     and every one of those questions turns on a published rule. */
  it.each([
    'how do I generate a share code for right to work',
    'what occupation code do I use for a software engineer on a Skilled Worker visa',
    'give me the code on the certificate of sponsorship'
  ])('leaves %#. to research', (question) => {
    expect(ruleRoute(question)).not.toBe('reason');
  });
});

describe('ruleRoute — writing something to send', () => {
  it.each([
    'draft an email to the client confirming their appointment',
    'write an email to Aisha about her application',
    'can you draft a reply to this message',
    'compose a short letter to the landlord',
    'rewrite this email so it is less blunt',
    'respond to their email asking for more time'
  ])('drafts %j rather than answering it', (question) => {
    expect(ruleRoute(question)).toBe('draft');
  });

  /* This rule runs before the domain net on purpose. A drafting request that
     names a route would otherwise be researched, and the person asking would
     get a page of guidance where they asked for a message they could send. */
  it('drafts a message about an immigration matter rather than researching it', () => {
    expect(ruleRoute('draft an email to the client about their ILR application')).toBe('draft');
  });

  /* Asking how to write one is a question. */
  it.each([
    'how do I write an email to the Home Office',
    'what should I say in an email chasing a decision'
  ])('leaves %j alone', (question) => {
    expect(ruleRoute(question)).not.toBe('draft');
  });

  /* Neither of these is a message to somebody. */
  it('does not claim a report or a Hub note', () => {
    expect(ruleRoute('write a report on this refusal')).not.toBe('draft');
    expect(ruleRoute('add a note to the client record')).not.toBe('draft');
  });
});

describe('groundIfDomain', () => {
  /* The failure this exists for, seen against the real model: a question about
     staying on Skilled Worker versus switching to Global Talent was phrased as
     "what would you do?", routed to reasoning, and produced a confident,
     well-argued answer that stated the qualifying periods for two settlement
     routes with nothing behind them and nothing marking them unverified. */
  it.each([
    'A client has been here 4 years on a Skilled Worker visa and is weighing ILR versus Global Talent. What would you do?',
    'Would you switch this client to the spouse visa or keep extending? Your view.',
    'Which is stronger for us, an appeal or a fresh application after a refusal?'
  ])('sends %j to research even when it asks for a view', (question) => {
    expect(groundIfDomain('reason', question)).toBe('research');
  });

  /* Reasoning has to survive this, or the override has quietly deleted a route.
     Nothing here turns on a published rule. */
  it.each([
    'Three consultants sit in a row and the one handling appeals is not at either end. Who sits where?',
    'If we bill 7 hours a day at 80% utilisation over 46 weeks, how many hours is that a year?',
    'Plan the order I should do these five things in, given the third depends on the first.'
  ])('leaves %j on the reasoning path', (question) => {
    expect(groundIfDomain('reason', question)).toBe('reason');
  });

  it('changes nothing about any other route', () => {
    expect(groundIfDomain('chat', 'hi')).toBe('chat');
    expect(groundIfDomain('hub', 'what are my tasks')).toBe('hub');
    expect(groundIfDomain('research', 'what is the ILR fee')).toBe('research');
    expect(groundIfDomain('action', 'add a task about the visa deadline')).toBe('action');
  });
});

describe('rulePhraseQuery', () => {
  /* The failure this exists for: the planner wrote "UK long residence ILR 10
     years 210 days absent", and GOV.UK's own search returned 42 results not
     including gov.uk/long-residence — the page that states the rule. The same
     search without the applicant's figures returned it first. No amount of
     re-ranking helps when the right page was never in the candidate pool. */
  /* Verified against the live index: this exact query returns
     gov.uk/long-residence first, where the planner's detailed one returned 42
     results without it. */
  it('reduces a case summary to the name of the rule', () => {
    expect(
      rulePhraseQuery(
        'my client has been here 9 years and 3 months with 210 days absent in one 12 month period, can she still get ILR on long residence'
      )
    ).toBe('UK long residence ilr');
  });

  it('prefers the fuller phrase over an abbreviation of the same thing', () => {
    expect(rulePhraseQuery('does indefinite leave to remain reset if they leave')).toBe(
      'UK indefinite leave to remain'
    );
  });

  it('says nothing when the question names no rule it knows', () => {
    expect(rulePhraseQuery('how long is the queue at the airport')).toBe('');
  });
});

describe('keywordQuery', () => {
  /* A case summary opens with the applicant's circumstances and names the ROUTE
     at the end. Taking the first surviving words filled the query with
     arithmetic and cut the phrase that identifies the right page — the search
     then returned the Student visa page and a Schengen article. */
  it('keeps the rule name from the end of a long question', () => {
    const query = keywordQuery(
      'My client has been in the UK for 9 years and 3 months with 210 days absent in one 12-month ' +
        'period, and wants to know about long residence ILR'
    );

    expect(query).toContain('long residence');
    expect(query).toContain('ilr');
  });

  it('restores the jurisdiction the length filter would drop', () => {
    expect(keywordQuery('what is the UK skilled worker minimum salary')).toContain('UK');
  });

  it('never returns something too short to search with', () => {
    expect(keywordQuery('fees?').length).toBeGreaterThan(0);
  });
});
