import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { PROJECTS_GUIDE } from '@/config/page-guides';
import type { Metadata } from 'next';
import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { CreateProjectDialog } from '@/features/projects/components/create-project-dialog';
import { ProjectsTable } from '@/features/projects/components/projects-table';
import { projectScopeCondition } from '@/features/projects/utils/scope';
import { db } from '@/lib/db/client';
import { clients, projectStatusEnum, projectTemplates, projects } from '@/lib/db/schema';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

export const metadata: Metadata = { title: 'Projects' };

// Matches createProject's own requireRole gate (features/projects/actions.ts) — kept as a
// literal role check here rather than reusing a staff-management predicate for an unrelated
// "can create" decision.
const CAN_CREATE_PROJECT_ROLES = ['TEAM_LEAD', 'MANAGER', 'ADMIN'] as const;

function parseListParam<T extends string>(
  value: string | string[] | undefined,
  validValues: readonly T[]
): T[] | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : value;
  const parts = raw
    .split(',')
    .filter((v): v is T => (validValues as readonly string[]).includes(v));
  return parts.length > 0 ? parts : undefined;
}

const SORTABLE_COLUMNS = {
  name: projects.name,
  clientName: clients.name,
  team: projects.team,
  status: projects.status
} as const;

export default async function ProjectsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Projects' access={false}>
        {null}
      </PageContainer>
    );
  }

  const canCreate = (CAN_CREATE_PROJECT_ROLES as readonly string[]).includes(employee.role);

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.perPage) || 10));
  const statusFilter = parseListParam(params.status, projectStatusEnum.enumValues);

  let sortColumn: (typeof SORTABLE_COLUMNS)[keyof typeof SORTABLE_COLUMNS] = projects.name;
  let sortDesc = false;
  const sortParam = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  if (sortParam) {
    try {
      const parsed = JSON.parse(sortParam) as { id: string; desc: boolean }[];
      const first = parsed[0];
      if (first && first.id in SORTABLE_COLUMNS) {
        sortColumn = SORTABLE_COLUMNS[first.id as keyof typeof SORTABLE_COLUMNS];
        sortDesc = first.desc;
      }
    } catch {
      // malformed sort param — fall back to the default
    }
  }

  const conditions: (SQL | undefined)[] = [projectScopeCondition(employee)];
  if (statusFilter) conditions.push(inArray(projects.status, statusFilter));
  const whereCondition = and(...conditions);

  const [rows, totalResult, availableClients, availableTemplates] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        team: projects.team,
        status: projects.status,
        clientName: clients.name
      })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(whereCondition)
      .orderBy(sortDesc ? desc(sortColumn) : asc(sortColumn))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ total: count() })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(whereCondition),
    canCreate
      ? db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(eq(clients.status, 'active'))
      : Promise.resolve([]),
    canCreate
      ? db
          .select({
            id: projectTemplates.id,
            name: projectTemplates.name,
            serviceLine: projectTemplates.serviceLine
          })
          .from(projectTemplates)
      : Promise.resolve([])
  ]);
  const pageCount = Math.max(1, Math.ceil(totalResult[0].total / perPage));

  return (
    <PageContainer
      pageTitle='Projects'
      infoContent={PROJECTS_GUIDE}
      pageDescription='Every project you have visibility into.'
      pageHeaderAction={
        canCreate ? (
          <CreateProjectDialog clients={availableClients} templates={availableTemplates} />
        ) : undefined
      }
    >
      {rows.length === 0 && pageCount <= 1 && !statusFilter ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.workspace />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? 'Create the first project to get started.'
                : "You aren't staffed on any projects yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ProjectsTable data={rows} pageCount={pageCount} />
      )}
    </PageContainer>
  );
}
