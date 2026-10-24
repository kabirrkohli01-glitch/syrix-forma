import type { Metadata } from 'next';
import { HR_ROTAS_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import {
  ClockCard,
  RotaList,
  SwapQueue,
  TimesheetList
} from '@/features/hr/components/work-panels';
import {
  isClockedIn,
  listClockEventsForDay,
  listShifts,
  listShiftSwaps,
  listTimesheets,
  listWorkSubjects
} from '@/features/hr/utils/work-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Rotas' };

/** Minutes worked today, paired from the clock event log rather than from a stored total. */
function minutesFromClockEvents(
  events: { eventType: string; occurredAt: Date }[],
  now: Date
): number {
  let total = 0;
  let runningSince: Date | null = null;

  for (const event of events) {
    if (event.eventType === 'in' || event.eventType === 'break_end') {
      runningSince = event.occurredAt;
    } else if ((event.eventType === 'out' || event.eventType === 'break_start') && runningSince) {
      total += event.occurredAt.getTime() - runningSince.getTime();
      runningSince = null;
    }
  }

  // Still clocked in: count up to now, so the figure is live rather than stuck at the last
  // completed pair.
  if (runningSince) total += now.getTime() - runningSince.getTime();
  return Math.round(total / 60_000);
}

export default async function RotasPage() {
  const caller = await requireActiveEmployeeForPage();
  const scope = hrScopeFor(caller);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='Rotas' access={false}>
        {null}
      </PageContainer>
    );
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 28 * 86_400_000).toISOString().slice(0, 10);

  const [shifts, swaps, timesheets, subjects, clockedIn, todayEvents] = await Promise.all([
    listShifts(caller, from, to),
    listShiftSwaps(caller),
    listTimesheets(caller),
    listWorkSubjects(caller),
    isClockedIn(caller.id),
    listClockEventsForDay(caller.id, today)
  ]);

  const canManage = scope === 'all' || subjects.some((s) => s.isReport);

  return (
    <PageContainer
      pageTitle='Rotas'
      infoContent={HR_ROTAS_GUIDE}
      pageDescription='Who is working when, hours recorded, and the weekly timesheet.'
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <ClockCard clockedIn={clockedIn} todayMinutes={minutesFromClockEvents(todayEvents, now)} />
        <SwapQueue swaps={swaps} callerId={caller.id} />
        <div className='grid gap-5 lg:grid-cols-2'>
          <RotaList
            shifts={shifts}
            subjects={subjects}
            canManage={canManage}
            callerId={caller.id}
          />
          <TimesheetList timesheets={timesheets} callerId={caller.id} />
        </div>
      </div>
    </PageContainer>
  );
}
