'use client';

import { format } from 'date-fns';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from '@/features/calendar/actions';

const NONE = '__none__';

export type EventOption = { id: string; name: string };

export type EditableEvent = {
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

function toLocalInputValue(date: Date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  employeeOptions,
  clientOptions,
  projectOptions,
  defaultClientId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EditableEvent | null;
  employeeOptions: EventOption[];
  clientOptions: EventOption[];
  projectOptions: EventOption[];
  /** Preselects a client in create mode — e.g. "Schedule meeting" from a client's own page. */
  defaultClientId?: string;
}) {
  const isEdit = event !== null;
  const canManage = event?.canManage ?? true;
  const [isPending, startTransition] = useTransition();

  // Initialized once from `event` at mount, not synced via an effect — the parent
  // (EventCalendar) remounts this component with a fresh `key` every time it opens the dialog for
  // a different intent (create vs. a specific event), so a plain lazy initializer here is enough
  // and avoids a render-triggers-setState effect for something that isn't an external system.
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [startAt, setStartAt] = useState(() => toLocalInputValue(event?.startAt ?? new Date()));
  const [endAt, setEndAt] = useState(() =>
    toLocalInputValue(event?.endAt ?? new Date(Date.now() + 60 * 60 * 1000))
  );
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [clientId, setClientId] = useState(event?.clientId ?? defaultClientId ?? NONE);
  const [projectId, setProjectId] = useState(event?.projectId ?? NONE);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendeeIds ?? []);

  function toggleAttendee(id: string, checked: boolean) {
    setAttendeeIds((prev) => (checked ? [...prev, id] : prev.filter((existing) => existing !== id)));
  }

  function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      allDay,
      clientId: clientId === NONE ? undefined : clientId,
      projectId: projectId === NONE ? undefined : projectId,
      attendeeIds
    };

    startTransition(async () => {
      try {
        if (isEdit) {
          await updateCalendarEvent(event.id, {
            ...payload,
            description: payload.description ?? null,
            location: payload.location ?? null,
            clientId: payload.clientId ?? null,
            projectId: payload.projectId ?? null
          });
          toast.success('Event updated');
        } else {
          await createCalendarEvent(payload);
          toast.success('Event created');
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save the event');
      }
    });
  }

  function handleDelete() {
    if (!event) return;
    startTransition(async () => {
      try {
        await deleteCalendarEvent(event.id);
        toast.success('Event deleted');
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete the event');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit event' : 'New event'}</DialogTitle>
            <DialogDescription>
              {isEdit ? 'Update this calendar event.' : 'Add a meeting, appointment, or deadline.'}
            </DialogDescription>
          </DialogHeader>
          <div className='flex max-h-[60vh] flex-col gap-3 overflow-y-auto py-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='event-title'>Title</Label>
              <Input
                id='event-title'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                disabled={!canManage}
                required
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='event-description'>Description</Label>
              <Textarea
                id='event-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                disabled={!canManage}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='event-location'>Location</Label>
              <Input
                id='event-location'
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={300}
                disabled={!canManage}
              />
            </div>
            <div className='flex items-center gap-2'>
              <Checkbox checked={allDay} onCheckedChange={(c) => setAllDay(c === true)} disabled={!canManage} />
              <Label>All day</Label>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='event-start'>Starts</Label>
                <Input
                  id='event-start'
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? startAt.slice(0, 10) : startAt}
                  onChange={(e) => setStartAt(allDay ? `${e.target.value}T00:00` : e.target.value)}
                  disabled={!canManage}
                  required
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='event-end'>Ends</Label>
                <Input
                  id='event-end'
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? endAt.slice(0, 10) : endAt}
                  onChange={(e) => setEndAt(allDay ? `${e.target.value}T23:59` : e.target.value)}
                  disabled={!canManage}
                  required
                />
              </div>
            </div>
            {clientOptions.length > 0 && (
              <div className='flex flex-col gap-1.5'>
                <Label>Client</Label>
                <Select value={clientId} onValueChange={(v) => setClientId(v ?? NONE)} disabled={!canManage}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {clientOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {projectOptions.length > 0 && (
              <div className='flex flex-col gap-1.5'>
                <Label>Project</Label>
                <Select value={projectId} onValueChange={(v) => setProjectId(v ?? NONE)} disabled={!canManage}>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='None' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {projectOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {employeeOptions.length > 0 && (
              <div className='flex flex-col gap-1.5'>
                <Label>Attendees</Label>
                <div className='flex max-h-36 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2'>
                  {employeeOptions.map((employee) => (
                    <label key={employee.id} className='flex items-center gap-2 text-sm'>
                      <Checkbox
                        checked={attendeeIds.includes(employee.id)}
                        onCheckedChange={(c) => toggleAttendee(employee.id, c === true)}
                        disabled={!canManage}
                      />
                      {employee.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className='flex items-center justify-between sm:justify-between'>
            {isEdit && canManage ? (
              <Button type='button' variant='destructive' size='sm' disabled={isPending} onClick={handleDelete}>
                <Icons.trash className='size-3.5' />
                Delete
              </Button>
            ) : (
              <span />
            )}
            {canManage && (
              <Button type='submit' disabled={isPending}>
                {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
