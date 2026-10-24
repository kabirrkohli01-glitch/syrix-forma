'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import type { EmployeeWorkload, ProjectHealthRow, WeeklyTrendRow } from '../utils/queries';
import type { ProjectHealth } from '../utils/health';

const WORKLOAD_CONFIG: ChartConfig = {
  openCount: { label: 'Open tasks', color: 'var(--chart-1)' }
};

// "Open tasks per employee" rather than the reference's "workload %" — there is no capacity/target
// figure in the data model to divide against, so a percentage here would be invented. This chart
// shows the same shape (one bar per person) using the real count instead.
export function OpenTasksByEmployeeChart({ rows }: { rows: EmployeeWorkload[] }) {
  const data = rows.slice(0, 8).map((r) => ({ name: r.name.split(' ')[0], openCount: r.openCount }));
  const total = data.reduce((sum, d) => sum + d.openCount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.chartBar className='text-muted-foreground size-4' />
          Open tasks by employee
        </CardTitle>
        <CardDescription>Who is carrying the most open work right now.</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <Empty className='p-4'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.checks />
              </EmptyMedia>
              <EmptyTitle>No open tasks</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer config={WORKLOAD_CONFIG} className='max-h-64 w-full'>
            <BarChart data={data} margin={{ left: -20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey='name' tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis hide allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey='openCount' fill='var(--color-openCount)' radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const TRENDS_CONFIG: ChartConfig = {
  tasksCreated: { label: 'Tasks created', color: 'var(--chart-2)' }
};

// "Tasks created per week" rather than the reference's "tasks completed" — tasks has no
// completedAt column (see getOperationalTrends' own comment), so "completed" can't be answered
// without guessing. Created is the honest equivalent shape.
export function TasksPerWeekChart({ rows }: { rows: WeeklyTrendRow[] }) {
  const data = rows.map((r) => ({ label: format(r.weekStart, 'MMM d'), tasksCreated: r.tasksCreated }));
  const total = data.reduce((sum, d) => sum + d.tasksCreated, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.chartBar className='text-muted-foreground size-4' />
          Tasks created per week
        </CardTitle>
        <CardDescription>Last {rows.length} weeks.</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <Empty className='p-4'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.checks />
              </EmptyMedia>
              <EmptyTitle>No tasks created in this window</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChartContainer config={TRENDS_CONFIG} className='max-h-64 w-full'>
            <BarChart data={data} margin={{ left: -20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey='label' tickLine={false} axisLine={false} interval={1} tickMargin={8} />
              <YAxis hide allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey='tasksCreated' fill='var(--color-tasksCreated)' radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const HEALTH_ORDER = { red: 0, amber: 1, green: 2 } as const;
const HEALTH_BAR_CLASS = { red: 'bg-destructive', amber: 'bg-chart-5', green: 'bg-chart-4' } as const;
const HEALTH_WIDTH_PCT = { red: 33, amber: 66, green: 100 } as const;

// A glance-level roll-up of the detailed Project Health table further down this page: one row
// per client (rather than per project), showing their worst project's health as a bar. Client
// activity has no numeric "score" in the data model, so this uses the same red/amber/green rule
// the Project Health table below already computes, rather than inventing a score out of 1000.
export function ClientHealthOverview({ rows }: { rows: ProjectHealthRow[] }) {
  const byClient = new Map<string, { clientName: string; projectCount: number; worst: ProjectHealth }>();
  for (const row of rows) {
    const existing = byClient.get(row.clientName);
    if (!existing) {
      byClient.set(row.clientName, { clientName: row.clientName, projectCount: 1, worst: row.health });
    } else {
      existing.projectCount += 1;
      if (HEALTH_ORDER[row.health] < HEALTH_ORDER[existing.worst]) existing.worst = row.health;
    }
  }
  const clientRows = [...byClient.values()].toSorted(
    (a, b) => HEALTH_ORDER[a.worst] - HEALTH_ORDER[b.worst]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client health</CardTitle>
        <CardDescription>Worst active project per client — see Project Health below for detail.</CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        {clientRows.length === 0 ? (
          <Empty className='p-4'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.checks />
              </EmptyMedia>
              <EmptyTitle>No active projects</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <table className='w-full text-sm'>
            <thead>
              <tr className='text-muted-foreground border-b text-left text-xs uppercase'>
                <th className='px-4 py-2 font-medium'>Client</th>
                <th className='px-4 py-2 font-medium'>Health</th>
                <th className='px-4 py-2 font-medium'>Projects</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.map((r) => (
                <tr key={r.clientName} className='border-b last:border-0'>
                  <td className='px-4 py-2.5 font-medium'>{r.clientName}</td>
                  <td className='px-4 py-2.5'>
                    <div
                      role='img'
                      aria-label={`Health: ${r.worst}`}
                      className='bg-muted h-2 w-24 overflow-hidden rounded-full'
                    >
                      <div
                        className={`h-full rounded-full ${HEALTH_BAR_CLASS[r.worst]}`}
                        style={{ width: `${HEALTH_WIDTH_PCT[r.worst]}%` }}
                      />
                    </div>
                  </td>
                  <td className='text-muted-foreground px-4 py-2.5'>{r.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
