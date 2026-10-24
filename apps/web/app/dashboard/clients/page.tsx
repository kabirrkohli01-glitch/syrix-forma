import { and, asc, count, desc, inArray, type SQL } from 'drizzle-orm';
import { CLIENTS_GUIDE } from '@/config/page-guides';
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
import { CreateClientDialog } from '@/features/clients/components/create-client-dialog';
import { ClientsTable } from '@/features/clients/components/clients-table';
import { clientScopeCondition } from '@/features/clients/utils/scope';
import { db } from '@/lib/db/client';
import { clientStatusEnum, clients } from '@/lib/db/schema';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { scopeForBusinessData } from '@/lib/permissions/roles';

// Matches createClient's own requireRole gate (features/clients/actions.ts) — kept as a
// literal role check here rather than reusing a staff-management predicate for an unrelated
// "can create" decision.
const CAN_CREATE_CLIENT_ROLES = ['TEAM_LEAD', 'MANAGER', 'ADMIN'] as const;

export const metadata: Metadata = { title: 'Clients' };

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
  name: clients.name,
  serviceLine: clients.serviceLine,
  team: clients.team,
  status: clients.status
} as const;

export default async function ClientsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await requireActiveEmployeeForPage();
  const scope = scopeForBusinessData(employee.role);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Clients' access={false}>
        {null}
      </PageContainer>
    );
  }

  const canCreate = (CAN_CREATE_CLIENT_ROLES as readonly string[]).includes(employee.role);

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.perPage) || 10));
  const statusFilter = parseListParam(params.status, clientStatusEnum.enumValues);

  let sortColumn: (typeof SORTABLE_COLUMNS)[keyof typeof SORTABLE_COLUMNS] = clients.name;
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

  const conditions: (SQL | undefined)[] = [clientScopeCondition(employee)];
  if (statusFilter) conditions.push(inArray(clients.status, statusFilter));
  const whereCondition = and(...conditions);

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        serviceLine: clients.serviceLine,
        team: clients.team,
        status: clients.status
      })
      .from(clients)
      .where(whereCondition)
      .orderBy(sortDesc ? desc(sortColumn) : asc(sortColumn))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(clients).where(whereCondition)
  ]);
  const pageCount = Math.max(1, Math.ceil(totalResult[0].total / perPage));

  return (
    <PageContainer
      pageTitle='Clients'
      infoContent={CLIENTS_GUIDE}
      pageDescription='Every client you have visibility into.'
      pageHeaderAction={canCreate ? <CreateClientDialog /> : undefined}
    >
      {rows.length === 0 && pageCount <= 1 && !statusFilter ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.teams />
            </EmptyMedia>
            <EmptyTitle>No clients yet</EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? 'Create the first client to get started.'
                : "You aren't staffed on any clients yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ClientsTable data={rows} pageCount={pageCount} />
      )}
    </PageContainer>
  );
}
