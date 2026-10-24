/* Dev harness for the SYRIX AI research pipeline.
 *
 * Runs the retrieval layer from the command line, without Next.js, a database,
 * or a model. That separation is the point: retrieval is what makes an answer
 * correct, so it has to be verifiable on its own before anything is judged on
 * how the answer reads.
 *
 *   npx tsx scripts/ai-probe.ts search "skilled worker visa salary threshold"
 *   npx tsx scripts/ai-probe.ts read https://www.gov.uk/skilled-worker-visa
 *   npx tsx scripts/ai-probe.ts guard
 *
 * Dev-only. Not imported by the app.
 */

import { search } from '../lib/ai/research/search';
import { readPage } from '../lib/ai/research/read-page';
import { selectSources, selectReading } from '../lib/ai/research/relevance';
import { isBlockedAddress, fetchText, BlockedRequestError } from '../lib/ai/research/http';
import { ask, type Mode } from '../lib/ai/pipeline/answer';
import { chainStatus } from '../lib/ai/gateway/client';
import { unverifiedForCommercialUse } from '../lib/ai/gateway/providers';

function age(iso?: string): string {
  if (!iso) return 'undated';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'undated';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

async function runSearch(query: string): Promise<void> {
  const started = Date.now();
  const outcome = await search(query);

  console.log(`\nQUERY   ${outcome.query}`);
  console.log(`ENGINE  ${outcome.engine ?? 'none'}   (${Date.now() - started}ms)`);
  console.log(`ATTEMPTS ${outcome.attempts.map((a) => `${a.engine}=${a.outcome}`).join('  ')}`);
  if (outcome.note) console.log(`NOTE    ${outcome.note}`);
  console.log('');

  const selection = selectSources(outcome.query, outcome.results);
  console.log(`LANES   ${selection.official.length} official + ${selection.general.length} general\n`);

  selection.all.forEach((result, index) => {
    console.log(`${String(index + 1).padStart(2)}. [${result.authority.toUpperCase()}] ${result.title}`);
    console.log(`    ${result.url}`);
    console.log(`    ${age(result.publishedAt)} · via ${result.engine}`);
    if (result.snippet) console.log(`    ${result.snippet.slice(0, 160)}`);
    console.log('');
  });

  console.log(`${outcome.results.length} results.`);
}

async function runRead(url: string, question: string): Promise<void> {
  const started = Date.now();
  const page = await readPage(url);

  console.log(`\nTITLE      ${page.title}`);
  console.log(`URL        ${page.url}`);
  console.log(`AUTHORITY  ${page.authority}`);
  console.log(`EXTRACTOR  ${page.via}`);
  console.log(`PUBLISHED  ${page.publishedAt ?? 'not stated'} (${age(page.publishedAt)})`);
  console.log(`LENGTH     ${page.length} chars in ${page.sections.length} sections   (${Date.now() - started}ms)`);
  console.log(`SECTIONS   ${page.sections.map((s) => s.title).slice(0, 20).join(' | ')}`);

  if (!question) {
    console.log(`\n--- first 1000 chars ---\n`);
    console.log(page.text.slice(0, 1000));
    return;
  }

  const reading = selectReading(page, question);
  console.log(`\nQUESTION   ${question}`);
  console.log(`SELECTED   ${reading.chosen.length} section(s), ${reading.text.length} chars${reading.omitted ? ' (more omitted for budget)' : ''}`);
  reading.chosen.forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.section.title}  score=${entry.score.toFixed(2)}  matched=[${entry.matched.join(', ')}]`);
  });
  if (reading.missingTerms.length) console.log(`NOT ON PAGE ${reading.missingTerms.join(', ')}`);
  console.log(`\n--- what the model would read (first 1400 chars) ---\n`);
  console.log(reading.text.slice(0, 1400));
  console.log('\n---');
}

/* The SSRF guard is the one part of this pipeline whose failure is silent: a
   hole does not produce a wrong answer, it produces a working answer plus a
   reachable internal network. So it is asserted rather than eyeballed. */
async function runGuard(): Promise<void> {
  const addresses: [string, boolean][] = [
    ['127.0.0.1', true],
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true]
  ];

  let failures = 0;
  console.log('\nADDRESS CHECKS');
  for (const [address, shouldBlock] of addresses) {
    const blocked = isBlockedAddress(address);
    const ok = blocked === shouldBlock;
    if (!ok) failures++;
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${address.padEnd(24)} blocked=${blocked} expected=${shouldBlock}`);
  }

  const urls: [string, string][] = [
    ['http://127.0.0.1:5432/', 'loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://[::1]:6379/', 'loopback v6'],
    ['file:///etc/passwd', 'non-http scheme'],
    ['http://user:pass@example.com/', 'embedded credentials'],
    ['http://10.0.0.1/admin', 'private range']
  ];

  console.log('\nFETCH REFUSALS');
  for (const [url, label] of urls) {
    try {
      await fetchText(url, { timeoutMs: 3000 });
      failures++;
      console.log(`  FAIL  ${label.padEnd(22)} ${url} was NOT refused`);
    } catch (error) {
      const refused = error instanceof BlockedRequestError;
      if (!refused) failures++;
      console.log(
        `  ${refused ? 'pass' : 'FAIL'}  ${label.padEnd(22)} ${refused ? 'refused' : 'wrong error'}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  console.log(`\n${failures === 0 ? 'All guard checks passed.' : `${failures} guard check(s) FAILED.`}`);
  if (failures > 0) process.exitCode = 1;
}

/* End to end: a question in, a sourced answer out. Needs a provider key. */
async function runAsk(question: string, mode: Mode): Promise<void> {
  console.log(`\nMODE    ${mode}`);
  console.log(`ASKED   ${question}\n`);

  const answer = await ask(question, {
    mode,
    /* The probe asks public research questions typed at a terminal, not
       questions built from Hub records, so the wider chain is available. */
    carriesHubContext: false,
    onStage: (stage, detail) => console.log(`  · ${stage}${detail ? ': ' + detail : ''}`),
    /* The model's own working, which the guards strip out of the answer. Shown
       here indented, because the whole point of the probe is seeing what the
       pipeline did rather than only what it returned. */
    onReasoning: (text) => console.log(`      ~ ${text}`)
  });

  console.log(`\n${'-'.repeat(70)}\n`);
  console.log(answer.text);
  console.log(`\n${'-'.repeat(70)}`);
  console.log(`\nROUTE     ${answer.route}`);
  console.log(`PROVIDER  ${answer.provider} (${answer.model})  ${(answer.ms / 1000).toFixed(1)}s`);
  if (answer.skipped.length) {
    console.log(`SKIPPED   ${answer.skipped.map((s) => `${s.provider} (${s.reason})`).join('; ')}`);
  }
  if (answer.guard.length) console.log(`GUARDS    ${answer.guard.join('; ')}`);
  if (answer.proposal) {
    console.log(`PROPOSED  ${answer.proposal.summary} (${answer.proposal.kind})`);
    answer.proposal.fields.forEach((field) => console.log(`            ${field.label}: ${field.value}`));
  }
  if (answer.hubReads.length) {
    console.log(`HUB READS ${answer.hubReads.map((read) => `${read.label} (${read.rows})`).join('; ')}`);
  }

  /* A turn that searched nothing verified nothing. Printing the research footer
     under it would report a check that never ran — and keying that off the route
     alone became wrong once drafting started retrieving: a draft about a
     published rule reads sources, and this line claimed it had not. */
  if (answer.route !== 'research' && !answer.citations.length) {
    console.log(`NO SEARCH  this turn was answered on the "${answer.route}" path — no sources were retrieved`);
    return;
  }

  console.log(`QUERIES   ${answer.queries.join(' | ')}`);
  console.log(`SOURCES   ${answer.citations.length}`);
  answer.citations.forEach((citation, index) => {
    console.log(`  ${index + 1}. [${citation.authority}] ${citation.label}`);
    console.log(`     ${citation.url}  (publisher date: ${citation.publishedAt ?? 'not stated'})`);
  });
  if (answer.unsupportedFigures.length) {
    console.log(`\n!! FIGURES IN NO SOURCE: ${answer.unsupportedFigures.join(', ')}`);
  } else {
    console.log(`\nEvery figure in this answer appears in a retrieved source.`);
  }
  if (answer.suspiciousSources.length) {
    console.log(`!! SUSPICIOUS SOURCES: ${answer.suspiciousSources.map((s) => `${s.label} (${s.signals.join(', ')})`).join('; ')}`);
  }
}

/* The sandboxed browser: does it launch, does it render, and does it refuse
   everything it must refuse? */
async function runBrowse(url: string): Promise<void> {
  const { BrowseSession, browserAvailable } = await import('../lib/ai/research/browser');

  console.log(`\nBrowser available: ${await browserAvailable()}`);

  const session = new BrowseSession();
  try {
    if (url) {
      const result = await session.open(url);
      console.log(`\nURL       ${result.url}`);
      console.log(`FINAL     ${result.finalUrl}`);
      console.log(`TITLE     ${result.title}`);
      console.log(`BLOCKED   ${result.blocked}`);
      console.log(`HTML      ${result.html.length} chars in ${result.ms}ms`);
      return;
    }

    console.log('\nSANDBOX REFUSALS');
    const refusals: [string, string][] = [
      ['http://127.0.0.1:5432/', 'loopback'],
      ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
      ['http://10.0.0.1/admin', 'private range'],
      ['file:///etc/passwd', 'non-http scheme']
    ];

    let failures = 0;
    for (const [target, label] of refusals) {
      try {
        await session.open(target);
        failures++;
        console.log(`  FAIL  ${label.padEnd(18)} was NOT refused`);
      } catch (error) {
        console.log(`  pass  ${label.padEnd(18)} ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    /* A public page proves the sandbox refuses the private ones specifically,
       rather than refusing everything and looking secure by being broken. */
    const control = await session.open('https://example.com/');
    const controlOk = control.html.length > 200;
    if (!controlOk) failures++;
    console.log(`  ${controlOk ? 'pass' : 'FAIL'}  ${'public control'.padEnd(18)} rendered ${control.html.length} chars`);

    console.log(`\n${failures === 0 ? 'All browser sandbox checks passed.' : `${failures} check(s) FAILED.`}`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await session.close();
    await (await import('../lib/ai/research/browser')).closeBrowser();
  }
}

/* The Hub brokers, exercised against the real database as a real employee.
 *
 * The employee is READ FROM THE DATABASE, never fabricated. The whole claim
 * these brokers make is that a read is scoped to the person asking, and a probe
 * that invented an ADMIN to test with would be checking the scoping against a
 * caller the scoping was written to trust.
 *
 * Only reads and proposals run here. Executing an approved action cannot be
 * probed from a terminal and should not be: the Hub's server actions resolve
 * the caller from a Clerk session, so there is none to resolve and the write
 * refuses. That refusal is the control working, not a gap in the harness.
 */
/* The pool holds the process open after the last query, which in a long-lived
   server is the point and in a one-shot script means it never exits. Closed
   explicitly by the commands that opened it. */
async function closeDatabase(): Promise<void> {
  const { db } = await import('../lib/db/client');
  await db.$client.end({ timeout: 5 });
}

async function callerFromDatabase() {
  const { db } = await import('../lib/db/client');
  const { employees } = await import('../lib/db/schema');
  const { eq } = await import('drizzle-orm');

  const [row] = await db.select().from(employees).where(eq(employees.status, 'active')).limit(1);
  if (!row || !row.role) return null;

  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    name: row.name,
    displayName: row.preferredName?.trim() || row.name,
    email: row.email,
    role: row.role,
    team: row.team,
    managerId: row.managerId,
    financeAccess: row.financeAccess,
    hrAdmin: false
  };
}

async function runHub(what: string): Promise<void> {
  const caller = await callerFromDatabase();
  if (!caller) {
    console.log('\nNo active employee with a role in the database. Seed one first.');
    process.exitCode = 1;
    return;
  }

  const context = await import('../lib/ai/hub/context');

  console.log(`\nAS        ${caller.name} — ${caller.role}${caller.team ? `, ${caller.team} team` : ''}`);
  console.log('SCOPE     business data is scoped to this role, never widened for the assistant\n');

  const wanted = what ? [what] : ['team', 'standing', 'tasks', 'calendar', 'clients', 'projects'];

  for (const read of wanted) {
    const reading =
      read === 'team'
        ? await context.readTeam(caller)
        : read === 'tasks'
          ? await context.readTasks(caller)
          : read === 'calendar'
            ? await context.readCalendar(caller, { days: 14 })
            : read === 'clients'
              ? await context.readClients(caller)
              : read === 'projects'
                ? await context.readProjects(caller)
                : await context.readMyStanding(caller);

    console.log(`--- ${read}: ${reading.label} (${reading.rows} row(s)) ---`);
    console.log(reading.text);
    console.log('');
  }
}

/* An action, proposed but never executed. Prints the card exactly as the user
   would see it, which is the thing worth checking: a card showing a summary of
   intent rather than real values is an approval control that does not work. */
async function runPropose(instruction: string): Promise<void> {
  const caller = await callerFromDatabase();
  if (!caller) {
    console.log('\nNo active employee with a role in the database. Seed one first.');
    process.exitCode = 1;
    return;
  }

  const answer = await ask(instruction, {
    mode: 'auto',
    caller,
    onStage: (stage, detail) => console.log(`  · ${stage}${detail ? ': ' + detail : ''}`)
  });

  console.log(`\nROUTE     ${answer.route}`);
  console.log(`SAID      ${answer.text}\n`);

  if (!answer.proposal) {
    console.log('NO CARD   nothing was proposed.');
    return;
  }

  console.log('--- the card ---');
  console.log(`  ${answer.proposal.summary}   (touches ${answer.proposal.resource})`);
  answer.proposal.fields.forEach((field) => console.log(`  ${field.label.padEnd(12)} ${field.value}`));
  console.log(`  reason: ${answer.proposal.reason}`);
  console.log('\nNOTHING WAS WRITTEN. A proposal is a card; only an approval executes it.');
}

/* An attachment, read the way a turn would read it.
 *
 * Worth its own command because the failure modes are quiet: a scanned PDF and
 * a readable one both "work", and the difference only shows up as an answer
 * that talks confidently about a document nobody could read. This prints what
 * the model would actually be given. */
async function runFile(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const { readAttachment } = await import('../lib/ai/uploads/attachments');

  const bytes = await fs.readFile(path);
  const extension = nodePath.extname(path).toLowerCase();
  const mime =
    extension === '.pdf'
      ? 'application/pdf'
      : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)
        ? `image/${extension === '.jpg' ? 'jpeg' : extension.slice(1)}`
        : 'text/plain';

  const attachment = readAttachment({
    name: nodePath.basename(path),
    mime,
    data: bytes.toString('base64')
  });

  console.log(`\nFILE      ${attachment.name}`);
  console.log(`KIND      ${attachment.kind}`);
  console.log(`BYTES     ${bytes.length.toLocaleString('en-GB')}`);
  console.log(`CHARS     ${attachment.text.length.toLocaleString('en-GB')} given to the model`);
  if (attachment.note) console.log(`NOTE      ${attachment.note}`);
  console.log(`\n--- what the model would read (first 1200 chars) ---\n`);
  console.log(attachment.text.slice(0, 1200));
  console.log('\n---');
}

function runChain(): void {
  console.log('\nPROVIDER CHAIN\n');
  for (const scope of [false, true] as const) {
    console.log(scope ? 'Requests carrying Hub context (no provider that retains input):' : 'Public research requests:');
    for (const tier of ['spark', 'zenith'] as const) {
      const chain = chainStatus(tier, scope);
      console.log(
        `  ${tier.padEnd(7)} ${chain.length ? chain.map((c) => `${c.provider}${c.cooling ? ' (cooling)' : ''}`).join(' -> ') : 'NOTHING CONFIGURED'}`
      );
    }
    console.log('');
  }

  const unverified = unverifiedForCommercialUse();
  if (unverified.length) {
    console.log('Terms not yet confirmed to permit commercial use (SYRIX Forma is commercial even with no revenue):');
    unverified.forEach((provider) => console.log(`  - ${provider.label}: ${provider.freeTier}`));
  }
}

/* WHAT THIS HOST CAN ACTUALLY DO.
 *
 * Written to be run from wherever the app is deployed, not from a developer's
 * machine. Everything SYRIX AI needs is either an environment variable or an
 * outbound host, and the difference between "the assistant is broken" and "this
 * container cannot reach data.sec.gov" is invisible from the interface — it
 * shows up as an answer that quietly lacks a lane.
 *
 * It reports whether a variable is SET, never what it contains. A diagnostic
 * that prints a token is a diagnostic that ends up pasted into a chat. */
const REQUIRED_ENV: { name: string; whatFor: string; optional?: boolean }[] = [
  { name: 'FORMA_AI_GATEWAY_URL', whatFor: 'where the assistant reaches its models' },
  { name: 'FORMA_AI_GATEWAY_TOKEN', whatFor: 'this deployment\'s revocable device token' },
  { name: 'FORMA_AI_GATEWAY_DEVICE', whatFor: 'which paired device this is' },
  { name: 'DATABASE_URL', whatFor: 'Hub records, for the routes that read them' },
  { name: 'CLERK_SECRET_KEY', whatFor: 'who is asking — no session, no Hub access' },
  { name: 'FORMA_AI_BROWSER', whatFor: 'set to "on" only where a Chromium is installed', optional: true },
  { name: 'SEARXNG_URL', whatFor: 'a self-hosted search instance, if one exists', optional: true }
];

const OUTBOUND: { label: string; url: string; whatFor: string }[] = [
  { label: 'gov.uk', url: 'https://www.gov.uk/api/search.json?q=visa&count=1', whatFor: 'the primary immigration lane' },
  { label: 'legislation.gov.uk', url: 'https://www.legislation.gov.uk/all/data.feed?text=immigration', whatFor: 'primary legislation' },
  { label: 'wikipedia', url: 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=test', whatFor: 'general background' },
  { label: 'bbc feeds', url: 'https://feeds.bbci.co.uk/news/rss.xml', whatFor: 'the news lane' },
  { label: 'gov.uk feeds', url: 'https://www.gov.uk/search/news-and-communications.atom', whatFor: 'official announcements' },
  { label: 'sec.gov', url: 'https://www.sec.gov/files/company_tickers.json', whatFor: 'filed company figures' },
  { label: 'data.sec.gov', url: 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json', whatFor: 'filed company figures' },
  { label: 'yahoo finance', url: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d', whatFor: 'quotes' }
];

async function runEnv(): Promise<void> {
  console.log('\nENVIRONMENT');
  for (const entry of REQUIRED_ENV) {
    const set = Boolean(process.env[entry.name]?.trim());
    const mark = set ? 'set    ' : entry.optional ? 'unset  ' : 'MISSING';
    console.log(`  ${mark}  ${entry.name.padEnd(24)} ${entry.whatFor}`);
  }

  console.log('\nOUTBOUND HOSTS');
  const { browserEnabled } = await import('../lib/ai/research/browser');

  for (const target of OUTBOUND) {
    const started = Date.now();
    try {
      const { status } = await fetchText(target.url, {
        timeoutMs: 15_000,
        userAgent: target.label.includes('sec.gov')
          ? `SYRIX Forma research assistant (${process.env.SEC_CONTACT_EMAIL || 'contact not configured'})`
          : undefined
      });
      console.log(`  ${String(status).padEnd(7)}  ${target.label.padEnd(20)} ${Date.now() - started}ms   ${target.whatFor}`);
    } catch (error) {
      console.log(
        `  BLOCKED  ${target.label.padEnd(20)} ${target.whatFor} — ${error instanceof Error ? error.message : error}`
      );
    }
  }

  console.log('\nOPTIONAL LANES');
  console.log(`  browser: ${browserEnabled() ? 'on' : 'off (HTTP lanes only — no loss unless an engine needs rendering)'}`);
  console.log(`  searxng: ${process.env.SEARXNG_URL?.trim() ? 'configured' : 'not configured'}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const argument = rest.join(' ').trim();

  if (command === 'search' && argument) return runSearch(argument);
  if (command === 'read' && rest[0]) return runRead(rest[0], rest.slice(1).join(' ').trim());
  if (command === 'guard') return runGuard();
  if (command === 'chain') return runChain();
  if (command === 'env') return runEnv();
  if (command === 'browse') return runBrowse(rest[0] ?? '');
  if (command === 'file' && rest[0]) return runFile(rest[0]);
  if (command === 'hub') return runHub(rest[0] ?? '').finally(closeDatabase);
  if (command === 'propose' && argument) return runPropose(argument).finally(closeDatabase);
  if ((command === 'ask' || command === 'spark' || command === 'zenith') && argument) {
    const mode: Mode = command === 'ask' ? 'auto' : (command as Mode);
    return runAsk(argument, mode);
  }

  console.log('Usage:');
  console.log('  npx tsx scripts/ai-probe.ts search "<query>"');
  console.log('  npx tsx scripts/ai-probe.ts read <url> [question]');
  console.log('  npx tsx scripts/ai-probe.ts guard');
  console.log('  npx tsx scripts/ai-probe.ts chain');
  console.log('  npx tsx scripts/ai-probe.ts env        (what this host has and can reach)');
  console.log('  npx tsx scripts/ai-probe.ts browse [url]   (no url = sandbox self-test)');
  console.log('  npx tsx scripts/ai-probe.ts file <path>   (what an attachment gives the model)');
  console.log('  npx tsx scripts/ai-probe.ts hub [team|tasks|calendar|clients|projects|standing]');
  console.log('  npx tsx scripts/ai-probe.ts propose "<instruction>"   (proposes, never writes)');
  console.log('  npx tsx scripts/ai-probe.ts ask|spark|zenith "<question>"');
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('\nProbe failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
