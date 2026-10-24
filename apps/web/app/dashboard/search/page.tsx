import { and, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Icons } from '@/components/icons';
import { SearchInput } from '@/features/search/components/search-input';
import { clientScopeCondition } from '@/features/clients/utils/scope';
import { projectScopeCondition } from '@/features/projects/utils/scope';
import { taskScopeCondition } from '@/features/tasks/utils/scope';
import { db } from '@/lib/db/client';
import { clients, documentLinks, emailActivity, employees, projects, tasks } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { SEARCH_GUIDE } from '@/config/page-guides';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Search' };

const RESULT_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

type ResultLink = { id: string; title: string; subtitle?: string; href: string };

function ResultSection({ title, icon, results }: { title: string; icon: keyof typeof Icons; results: ResultLink[] }) {
  const Icon = Icons[icon];
  if (results.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Icon className='size-4' />
          {title}
          <Badge variant='secondary'>{results.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col gap-2'>
          {results.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className='block text-sm hover:underline'>
                <span className='font-medium'>{r.title}</span>
                {r.subtitle && <span className='text-muted-foreground ml-2 text-xs'>{r.subtitle}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Search' access={false}>
        {null}
      </PageContainer>
    );
  }

  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? '').trim();
  const pattern = `%${query}%`;
  const canSearch = query.length >= MIN_QUERY_LENGTH;

  // Documents/emails reuse Client/Project's own scope conditions joined against their parent —
  // a row whose parent doesn't pass that check is excluded, same as everywhere else those
  // conditions are used. A row with neither client nor project set (e.g. an email only linked to
  // an enquiry) is conservatively excluded outside 'all'/'cross-team' scope rather than building a
  // fourth join for an edge case — under-showing, never over-exposing.
  const [clientResults, projectResults, taskResults, employeeResults, documentResults, emailResults] = canSearch
    ? await Promise.all([
        db
          .select({ id: clients.id, name: clients.name, serviceLine: clients.serviceLine })
          .from(clients)
          .where(and(clientScopeCondition(employee), ilike(clients.name, pattern)))
          .limit(RESULT_LIMIT),
        db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(projectScopeCondition(employee), ilike(projects.name, pattern)))
          .limit(RESULT_LIMIT),
        db
          .select({ id: tasks.id, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(and(taskScopeCondition(employee), isNull(tasks.archivedAt), ne(tasks.status, 'done'), ilike(tasks.title, pattern)))
          .limit(RESULT_LIMIT),
        db
          .select({ id: employees.id, name: employeeDisplayName, team: employees.team })
          .from(employees)
          .where(
            and(
              eq(employees.status, 'active'),
              scope === 'all' || scope === 'cross-team'
                ? undefined
                : employee.team
                  ? eq(employees.team, employee.team)
                  : eq(employees.id, employee.id),
              // Matches the account-of-record name as well as the display name, so searching a
              // colleague's full legal name still finds them after that colleague has set a
              // shorter name for themselves.
              or(
                ilike(employees.name, pattern),
                ilike(employees.preferredName, pattern),
                ilike(employees.email, pattern)
              )
            )
          )
          .limit(RESULT_LIMIT),
        db
          .select({
            id: documentLinks.id,
            label: documentLinks.label,
            clientId: documentLinks.clientId,
            projectId: documentLinks.projectId,
            taskId: documentLinks.taskId
          })
          .from(documentLinks)
          .leftJoin(clients, eq(documentLinks.clientId, clients.id))
          .leftJoin(projects, eq(documentLinks.projectId, projects.id))
          .leftJoin(tasks, eq(documentLinks.taskId, tasks.id))
          .where(
            and(
              ilike(documentLinks.label, pattern),
              or(clientScopeCondition(employee), projectScopeCondition(employee), taskScopeCondition(employee))
            )
          )
          .limit(RESULT_LIMIT),
        db
          .select({
            id: emailActivity.id,
            subject: emailActivity.subject,
            clientId: emailActivity.clientId,
            projectId: emailActivity.projectId
          })
          .from(emailActivity)
          .leftJoin(clients, eq(emailActivity.clientId, clients.id))
          .leftJoin(projects, eq(emailActivity.projectId, projects.id))
          .where(
            and(
              ilike(emailActivity.subject, pattern),
              or(clientScopeCondition(employee), projectScopeCondition(employee))
            )
          )
          .limit(RESULT_LIMIT)
      ])
    : [[], [], [], [], [], []];

  const clientIdsForDocs = [...new Set(documentResults.map((d) => d.clientId).filter((id): id is string => !!id))];
  const clientNamesForDocs = clientIdsForDocs.length
    ? await db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIdsForDocs))
    : [];
  const clientNameMap = new Map(clientNamesForDocs.map((c) => [c.id, c.name]));

  const documentLinkResults: ResultLink[] = documentResults.map((d) => ({
    id: d.id,
    title: d.label,
    href: d.clientId
      ? `/dashboard/clients/${d.clientId}`
      : d.projectId
        ? `/dashboard/projects/${d.projectId}`
        : `/dashboard/my-work/${d.taskId}`,
    subtitle: d.clientId ? clientNameMap.get(d.clientId) : undefined
  }));

  const emailResultRows: ResultLink[] = emailResults.map((e) => ({
    id: e.id,
    title: e.subject || '(no subject)',
    href: e.clientId ? `/dashboard/clients/${e.clientId}` : `/dashboard/projects/${e.projectId}`
  }));

  const sections = [
    { title: 'Clients', icon: 'teams' as const, results: clientResults.map((c) => ({ id: c.id, title: c.name, subtitle: c.serviceLine ?? undefined, href: `/dashboard/clients/${c.id}` })) },
    { title: 'Projects', icon: 'workspace' as const, results: projectResults.map((p) => ({ id: p.id, title: p.name, href: `/dashboard/projects/${p.id}` })) },
    { title: 'Tasks', icon: 'checks' as const, results: taskResults.map((t) => ({ id: t.id, title: t.title, subtitle: t.status, href: `/dashboard/my-work/${t.id}` })) },
    { title: 'Staff', icon: 'user' as const, results: employeeResults.map((e) => ({ id: e.id, title: e.name, subtitle: e.team ?? undefined, href: '/dashboard/teams' })) },
    { title: 'Documents', icon: 'paperclip' as const, results: documentLinkResults },
    { title: 'Emails', icon: 'chat' as const, results: emailResultRows }
  ];

  const totalResults = sections.reduce((sum, s) => sum + s.results.length, 0);

  return (
    <PageContainer
      pageTitle='Search'
      pageDescription='Search across clients, projects, tasks, staff, documents, and emails.'
      infoContent={SEARCH_GUIDE}
    >
      <div className='flex flex-col gap-4'>
        <SearchInput initialQuery={query} />

        {!canSearch ? (
          <p className='text-muted-foreground text-sm'>Type at least {MIN_QUERY_LENGTH} characters to search.</p>
        ) : totalResults === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.search />
              </EmptyMedia>
              <EmptyTitle>No results for &quot;{query}&quot;</EmptyTitle>
              <EmptyDescription>Only results you have permission to see are ever shown.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            {sections.map((section) => (
              <ResultSection key={section.title} title={section.title} icon={section.icon} results={section.results} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
