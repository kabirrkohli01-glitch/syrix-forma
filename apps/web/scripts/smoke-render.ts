/**
 * Renders every dashboard screen as a real signed-in employee, against the real database.
 *
 *   npm run smoke                      # as the first ADMIN it finds
 *   npm run smoke -- kabir@example.com # as a specific person
 *
 * Why this exists: the routes cannot be opened from a script over HTTP, because every one of
 * them redirects to Clerk before rendering anything. Server-rendering them here is the closest
 * thing to opening each page — real permissions, real queries, real components — and it is the
 * only check that catches a page which typechecks, passes its unit tests, and still throws the
 * moment someone looks at it.
 *
 * It reports what each screen would actually show that person, not just that it did not throw.
 * A page that renders an access refusal is working correctly and is reported as refused, which
 * is a different thing from broken and needs to read differently.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';

// Stubbed before any page module is imported, so `auth()` inside a Server Component resolves to
// the chosen employee. Nothing else about the request path is faked.
const clerkUserId = { value: '' };
patchModules();

/**
 * tsx has no module mocking, so modules are swapped in the loader before any page imports them.
 *
 * Two different things are being replaced here and they should not be confused.
 *
 * `@clerk/nextjs/server` is replaced to choose *who* is signed in. That is the whole point of
 * the exercise, and nothing else about authorisation is faked: every permission predicate and
 * every scoped query then runs for real against that person.
 *
 * The rest — the router hooks, nuqs, the query client, Clerk's browser components — are
 * *framework context that the real app layout provides* and a bare renderToStaticMarkup call
 * does not. A client component asking for the router outside Next's runtime throws whatever the
 * page is doing, so leaving them out would report four working screens as broken and teach
 * whoever ran this to ignore the output. The repo's own page tests stub the same hooks for the
 * same reason. What is deliberately NOT stubbed is anything that decides what data comes back.
 */
function patchModules() {
  const Module = require('node:module');
  const original = Module._load;

  const noopRouter = {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {}
  };

  Module._load = function patched(request: string, ...rest: unknown[]) {
    if (request === '@clerk/nextjs/server') {
      return {
        auth: Object.assign(async () => ({ userId: clerkUserId.value, sessionId: 'smoke-session' }), {
          protect: async () => ({ userId: clerkUserId.value, sessionId: 'smoke-session' })
        }),
        currentUser: async () => null,
        clerkClient: async () => ({ users: {}, sessions: {} })
      };
    }

    if (request === '@clerk/nextjs') {
      const passthrough = ({ children }: { children?: unknown }) => children ?? null;
      return {
        ClerkProvider: passthrough,
        UserProfile: () => createElement('div', null, 'Clerk account panel'),
        SignIn: passthrough,
        SignUp: passthrough,
        useUser: () => ({ user: null, isLoaded: true, isSignedIn: true }),
        useSession: () => ({ session: null, isLoaded: true }),
        useClerk: () => ({ signOut: () => {} }),
        useAuth: () => ({ userId: clerkUserId.value, isLoaded: true, isSignedIn: true })
      };
    }

    const loaded = original.call(this, request, ...rest);

    if (request === 'next/navigation') {
      // redirect() and notFound() are left real — they are how a page refuses, and the caller
      // reports that as a refusal rather than a failure.
      return {
        ...loaded,
        useRouter: () => noopRouter,
        usePathname: () => '/dashboard',
        useSearchParams: () => new URLSearchParams(),
        useParams: () => ({}),
        useSelectedLayoutSegment: () => null
      };
    }

    if (request === 'nuqs') {
      return {
        ...loaded,
        useQueryState: (_key: string, options?: { defaultValue?: unknown }) => [
          options?.defaultValue ?? null,
          () => {}
        ],
        useQueryStates: (keys: Record<string, { defaultValue?: unknown }>) => [
          Object.fromEntries(
            Object.entries(keys).map(([key, value]) => [key, value?.defaultValue ?? null])
          ),
          () => {}
        ]
      };
    }

    // SYRIX AI's conversation lives in the dashboard layout, above both the side panel and the
    // full tab, so that one question is shared between them. A bare page render has no layout
    // and therefore no provider, and useConversation throws by design when called without one.
    // Stubbed for the same reason as the router and the query client: it is context the real
    // app supplies, not a decision about what data comes back.
    // Matched on the trailing path rather than an exact specifier: the components import it
    // relatively ('../store/conversation') while the layout uses the '@/' alias, and both have
    // to hit this branch.
    if (request.endsWith('store/conversation')) {
      return {
        ...loaded,
        ConversationProvider: ({ children }: { children?: unknown }) => children ?? null,
        useConversation: () => ({
          turns: [],
          mode: 'auto',
          setMode: () => {},
          ask: () => {},
          stop: () => {},
          reset: () => {},
          pendingFiles: [],
          attachFiles: () => {},
          removeFile: () => {},
          approve: () => {},
          deny: () => {},
          busy: false
        })
      };
    }

    if (request === '@tanstack/react-query') {
      const passthrough = ({ children }: { children?: unknown }) => children ?? null;
      return {
        ...loaded,
        QueryClientProvider: passthrough,
        useQuery: () => ({ data: undefined, isLoading: true, isError: false, error: null }),
        useMutation: () => ({ mutate: () => {}, isPending: false }),
        useQueryClient: () => ({ invalidateQueries: () => {} })
      };
    }

    return loaded;
  };
}

type Screen = { label: string; path: string; load: () => Promise<{ default: Function }> };

const SCREENS: Screen[] = [
  { label: 'Home', path: '/dashboard', load: () => import('@/app/dashboard/page') },
  { label: 'My Work', path: '/dashboard/my-work', load: () => import('@/app/dashboard/my-work/page') },
  { label: 'Clients', path: '/dashboard/clients', load: () => import('@/app/dashboard/clients/page') },
  { label: 'Projects', path: '/dashboard/projects', load: () => import('@/app/dashboard/projects/page') },
  { label: 'Calendar', path: '/dashboard/calendar', load: () => import('@/app/dashboard/calendar/page') },
  { label: 'Email', path: '/dashboard/email', load: () => import('@/app/dashboard/email/page') },
  { label: 'Team Chat', path: '/dashboard/chat', load: () => import('@/app/dashboard/chat/page') },
  { label: 'Documents', path: '/dashboard/documents', load: () => import('@/app/dashboard/documents/page') },
  { label: 'Teams', path: '/dashboard/teams', load: () => import('@/app/dashboard/teams/page') },
  { label: 'HR — People', path: '/dashboard/hr', load: () => import('@/app/dashboard/hr/page') },
  { label: 'HR — Time Off', path: '/dashboard/hr/time-off', load: () => import('@/app/dashboard/hr/time-off/page') },
  { label: 'HR — Absence', path: '/dashboard/hr/absence', load: () => import('@/app/dashboard/hr/absence/page') },
  { label: 'HR — Documents', path: '/dashboard/hr/documents', load: () => import('@/app/dashboard/hr/documents/page') },
  { label: 'HR — Performance', path: '/dashboard/hr/performance', load: () => import('@/app/dashboard/hr/performance/page') },
  { label: 'HR — Rotas', path: '/dashboard/hr/rotas', load: () => import('@/app/dashboard/hr/rotas/page') },
  { label: 'HR — Expenses', path: '/dashboard/hr/expenses', load: () => import('@/app/dashboard/hr/expenses/page') },
  { label: 'HR — Learning', path: '/dashboard/hr/learning', load: () => import('@/app/dashboard/hr/learning/page') },
  { label: 'HR — Safety', path: '/dashboard/hr/safety', load: () => import('@/app/dashboard/hr/safety/page') },
  { label: 'HR — Hiring', path: '/dashboard/hr/hiring', load: () => import('@/app/dashboard/hr/hiring/page') },
  { label: 'HR — Reports', path: '/dashboard/hr/reports', load: () => import('@/app/dashboard/hr/reports/page') },
  { label: 'HR — Settings', path: '/dashboard/hr/settings', load: () => import('@/app/dashboard/hr/settings/page') },
  { label: 'Automations', path: '/dashboard/automations', load: () => import('@/app/dashboard/automations/page') },
  { label: 'Reports', path: '/dashboard/reports', load: () => import('@/app/dashboard/reports/page') },
  { label: 'Search', path: '/dashboard/search', load: () => import('@/app/dashboard/search/page') },
  { label: 'Settings — Account', path: '/dashboard/settings', load: () => import('@/app/dashboard/settings/[[...profile]]/page') },
  { label: 'Settings — People & Access', path: '/dashboard/settings/access', load: () => import('@/app/dashboard/settings/access/page') },
  { label: 'Settings — Connectors', path: '/dashboard/settings/connectors', load: () => import('@/app/dashboard/settings/connectors/page') },
  { label: 'Settings — Integrations', path: '/dashboard/settings/integrations', load: () => import('@/app/dashboard/settings/integrations/page') },
  { label: 'Settings — Project Templates', path: '/dashboard/settings/project-templates', load: () => import('@/app/dashboard/settings/project-templates/page') },
  { label: 'Settings — SYRIX AI', path: '/dashboard/settings/forma-ai', load: () => import('@/app/dashboard/settings/forma-ai/page') },
  // The assistant's own full-tab mount, as opposed to its settings screen. Missing from this
  // list until now, which is how a screen reachable from the sidebar went without the one check
  // that actually renders it.
  { label: 'SYRIX AI', path: '/dashboard/forma-ai', load: () => import('@/app/dashboard/forma-ai/page') }
];

/** Pages take `searchParams` as a promise; the ones that read it are given an empty set. */
const EMPTY_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

function describe(html: string): string {
  if (html.includes('do not have access') || html.includes('You do not have')) return 'refused';
  if (html.includes('Something went wrong')) return 'error state';
  return `${html.length.toLocaleString()} bytes`;
}

async function main() {
  const wanted = process.argv[2];

  const [person] = wanted
    ? await db.select().from(employees).where(eq(employees.email, wanted)).limit(1)
    : await db.select().from(employees).where(eq(employees.role, 'ADMIN')).limit(1);

  if (!person) {
    console.error(wanted ? `No employee with email ${wanted}` : 'No ADMIN employee found');
    process.exit(1);
  }

  clerkUserId.value = person.clerkUserId;
  console.log(
    `Rendering as ${person.preferredName || person.name} <${person.email}> — ${person.role}` +
      `${person.hrAdmin ? ' + HR administration' : ''}${person.financeAccess ? ' + finance' : ''}\n`
  );

  let failed = 0;
  let refused = 0;

  for (const screen of SCREENS) {
    try {
      const mod = await screen.load();
      const element = await mod.default(EMPTY_PROPS);
      const html = renderToStaticMarkup(element);
      const summary = describe(html);
      if (summary === 'refused') refused++;
      console.log(`  ok       ${screen.label.padEnd(30)} ${summary}`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      // A redirect or a notFound is Next's own control flow, not a failure — it is how a page
      // says "you may not see this", and saying so is the page working.
      if (/NEXT_REDIRECT|NEXT_NOT_FOUND/.test(message)) {
        failed--;
        refused++;
        console.log(`  ok       ${screen.label.padEnd(30)} not available to this account`);
        continue;
      }
      console.log(`  FAILED   ${screen.label.padEnd(30)} ${message.split('\n')[0]}`);
    }
  }

  console.log(
    `\n${SCREENS.length - failed}/${SCREENS.length} screens rendered` +
      `${refused ? `, ${refused} of them a deliberate refusal` : ''}` +
      `${failed ? `, ${failed} FAILED` : ''}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
