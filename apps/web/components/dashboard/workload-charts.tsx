'use client';

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from 'recharts';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';

export type TaskStatusSlice = {
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  label: string;
  count: number;
};

export type TaskPrioritySlice = {
  priority: 'low' | 'medium' | 'high' | 'urgent';
  label: string;
  count: number;
};

export type DeadlineDayBucket = {
  date: string;
  label: string;
  count: number;
};

const STATUS_CONFIG: ChartConfig = {
  count: { label: 'Tasks' },
  todo: { label: 'To do', color: 'var(--chart-3)' },
  in_progress: { label: 'In progress', color: 'var(--chart-2)' },
  blocked: { label: 'Blocked', color: 'var(--destructive)' },
  done: { label: 'Done', color: 'var(--chart-4)' }
};

const PRIORITY_CONFIG: ChartConfig = {
  count: { label: 'Tasks' },
  low: { label: 'Low', color: 'var(--chart-3)' },
  medium: { label: 'Medium', color: 'var(--chart-2)' },
  high: { label: 'High', color: 'var(--chart-5)' },
  urgent: { label: 'Urgent', color: 'var(--destructive)' }
};

const DEADLINE_CONFIG: ChartConfig = {
  count: { label: 'Deadlines', color: 'var(--chart-1)' }
};

function ChartEmpty({ label }: { label: string }) {
  return (
    <Empty className='p-4'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.checks />
        </EmptyMedia>
        <EmptyTitle>{label}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function TaskStatusChart({ data }: { data: TaskStatusSlice[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.chartDonut className='text-muted-foreground size-4' />
          Task status
        </CardTitle>
        <CardDescription>Every task assigned to you, by status.</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <ChartEmpty label='No tasks assigned yet' />
        ) : (
          <ChartContainer config={STATUS_CONFIG} className='mx-auto aspect-square max-h-56'>
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey='status' />} />
              <Pie data={data} dataKey='count' nameKey='status' innerRadius={45} outerRadius={75} strokeWidth={2}>
                {data.map((slice) => (
                  <Cell key={slice.status} fill={`var(--color-${slice.status})`} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey='status' />} />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function TaskPriorityChart({ data }: { data: TaskPrioritySlice[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.chartBar className='text-muted-foreground size-4' />
          Open tasks by priority
        </CardTitle>
        <CardDescription>What&apos;s still open, weighted by urgency.</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <ChartEmpty label='Nothing on your plate right now' />
        ) : (
          <ChartContainer config={PRIORITY_CONFIG} className='max-h-56 w-full'>
            <BarChart data={data} layout='vertical' margin={{ left: 8 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type='number' hide allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey='priority' />} />
              <Bar dataKey='count' radius={4}>
                {data.map((slice) => (
                  <Cell key={slice.priority} fill={`var(--color-${slice.priority})`} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function DeadlineTimelineChart({ data }: { data: DeadlineDayBucket[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.chartBar className='text-muted-foreground size-4' />
          Deadlines — next 14 days
        </CardTitle>
        <CardDescription>Milestones and meetings you&apos;re involved in, by day.</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <ChartEmpty label='Nothing coming up' />
        ) : (
          <ChartContainer config={DEADLINE_CONFIG} className='max-h-56 w-full'>
            <BarChart data={data} margin={{ left: -20 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey='label'
                tickLine={false}
                axisLine={false}
                interval={1}
                tickMargin={8}
              />
              <ChartTooltip content={<ChartTooltipContent indicator='line' />} />
              <Bar dataKey='count' fill='var(--color-count)' radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
