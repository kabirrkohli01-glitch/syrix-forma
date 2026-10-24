'use client';

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths
} from 'date-fns';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { EventFormDialog, type EditableEvent, type EventOption } from './event-form-dialog';

// Color-codes each event by what it's linked to — the only categorical distinction the data
// actually carries (calendarEvents has no separate "type" column). Reuses the app-wide tone
// system (lib/status-colors.ts) rather than introducing new one-off colors.
const EVENT_CATEGORY = {
  client: { label: 'Client meeting', chip: 'border-l-chart-2 bg-chart-2/10 text-chart-2', dot: 'bg-chart-2' },
  project: { label: 'Project event', chip: 'border-l-chart-5 bg-chart-5/10 text-chart-5', dot: 'bg-chart-5' },
  internal: { label: 'Internal', chip: 'border-l-primary bg-primary/10 text-primary', dot: 'bg-primary' }
} as const;

function categoryFor(event: Pick<CalendarEventRow, 'clientId' | 'projectId'>): keyof typeof EVENT_CATEGORY {
  if (event.clientId) return 'client';
  if (event.projectId) return 'project';
  return 'internal';
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;

export type CalendarEventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  clientId: string | null;
  projectId: string | null;
  attendeeIds: string[];
  canManage: boolean;
};

export function EventCalendar({
  events,
  month,
  employeeOptions,
  clientOptions,
  projectOptions
}: {
  events: CalendarEventRow[];
  month: Date;
  employeeOptions: EventOption[];
  clientOptions: EventOption[];
  projectOptions: EventOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EditableEvent | null>(null);
  // Bumped on every open so EventFormDialog remounts with fresh initial state each time, whether
  // that's a new "create" or a different (or the same) event — see event-form-dialog.tsx.
  const [dialogInstanceKey, setDialogInstanceKey] = useState(0);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function goToMonth(target: Date) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', format(target, 'yyyy-MM'));
    router.push(`${pathname}?${params.toString()}`);
  }

  function openCreate() {
    setSelectedEvent(null);
    setDialogInstanceKey((k) => k + 1);
    setDialogOpen(true);
  }

  function openEdit(event: CalendarEventRow) {
    setSelectedEvent({
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      clientId: event.clientId,
      projectId: event.projectId,
      attendeeIds: event.attendeeIds,
      canManage: event.canManage
    });
    setDialogInstanceKey((k) => k + 1);
    setDialogOpen(true);
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* The month name and the controls beside it come to more than the width of a small phone,
          so the controls drop to their own line rather than extending past the screen edge. */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-xl font-semibold'>{format(month, 'MMMM yyyy')}</h2>
        <div className='flex items-center gap-1.5'>
          <div className='flex items-center gap-0.5 rounded-lg border p-0.5'>
            <Button
              variant='ghost'
              size='icon-sm'
              className='rounded-md'
              aria-label='Previous month'
              onClick={() => goToMonth(subMonths(month, 1))}
            >
              <Icons.chevronLeft />
            </Button>
            <Button variant='ghost' size='sm' className='rounded-md' onClick={() => goToMonth(new Date())}>
              Today
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              className='rounded-md'
              aria-label='Next month'
              onClick={() => goToMonth(addMonths(month, 1))}
            >
              <Icons.chevronRight />
            </Button>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Icons.add />
            New event
          </Button>
        </div>
      </div>

      <div className='border-border grid grid-cols-7 gap-px overflow-hidden rounded-lg border text-xs'>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className='bg-muted/40 text-muted-foreground p-2.5 text-center font-semibold tracking-wide'>
            {label}
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = events.filter((e) => isSameDay(e.startAt, day));
          const overflow = dayEvents.length - MAX_PER_DAY;
          const inMonth = isSameMonth(day, month);
          return (
            <div
              key={day.toISOString()}
              className={`bg-card border-border/40 min-h-28 border-t p-2 transition-colors duration-150 ${
                inMonth ? '' : 'bg-muted/10'
              }`}
            >
              <span
                className={
                  isToday(day)
                    ? 'bg-primary text-primary-foreground inline-flex size-6 items-center justify-center rounded-full font-semibold'
                    : `inline-flex size-6 items-center justify-center ${inMonth ? 'text-foreground' : 'text-muted-foreground/50'}`
                }
              >
                {format(day, 'd')}
              </span>
              <div className='mt-1.5 flex flex-col gap-1'>
                {dayEvents.slice(0, MAX_PER_DAY).map((event) => {
                  const category = EVENT_CATEGORY[categoryFor(event)];
                  return (
                    <button
                      key={event.id}
                      type='button'
                      onClick={() => openEdit(event)}
                      className={`truncate rounded-sm border-l-2 px-1.5 py-1 text-left font-medium transition-opacity duration-150 hover:opacity-80 ${category.chip}`}
                      title={event.title}
                    >
                      {!event.allDay && <span className='opacity-70'>{format(event.startAt, 'HH:mm')} </span>}
                      {event.title}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <span className='text-muted-foreground px-1.5 font-medium'>+{overflow} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className='text-muted-foreground flex flex-wrap items-center gap-4 text-xs'>
        {Object.values(EVENT_CATEGORY).map((category) => (
          <div key={category.label} className='flex items-center gap-1.5'>
            <span className={`size-2 rounded-full ${category.dot}`} aria-hidden />
            {category.label}
          </div>
        ))}
      </div>

      <EventFormDialog
        key={dialogInstanceKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={selectedEvent}
        employeeOptions={employeeOptions}
        clientOptions={clientOptions}
        projectOptions={projectOptions}
      />
    </div>
  );
}
