'use client';

import { useState, useTransition } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addClientNote, removeClientNote } from '@/features/clients/notes-actions';

export type ClientNoteRow = {
  id: string;
  body: string;
  authorEmployeeId: string | null;
  authorName: string;
  createdAt: Date;
};

export function ClientNotesCard({
  clientId,
  notes,
  currentEmployeeId
}: {
  clientId: string;
  notes: ClientNoteRow[];
  currentEmployeeId: string;
}) {
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await addClientNote(clientId, { body: body.trim() });
        setBody('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add note');
      }
    });
  }

  function handleRemove(noteId: string) {
    startTransition(async () => {
      try {
        await removeClientNote(noteId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove note');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {notes.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No notes yet.</p>
      ) : (
        <ul className='flex flex-col gap-3'>
          {notes.map((note) => (
            <li key={note.id} className='flex flex-col gap-1 rounded-lg border p-2.5 text-sm'>
              <div className='flex items-center justify-between gap-2'>
                <span className='font-medium'>{note.authorName}</span>
                <div className='flex items-center gap-2'>
                  <span className='text-muted-foreground text-xs'>{format(note.createdAt, 'MMM d, yyyy HH:mm')}</span>
                  {note.authorEmployeeId === currentEmployeeId && (
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      disabled={isPending}
                      onClick={() => handleRemove(note.id)}
                      aria-label='Remove note'
                    >
                      <Icons.close className='size-3.5' />
                    </Button>
                  )}
                </div>
              </div>
              <p className='whitespace-pre-wrap'>{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className='flex flex-col gap-2'>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder='Add a note' maxLength={5000} rows={2} />
        <Button type='submit' size='sm' className='self-end' disabled={isPending || !body.trim()}>
          Add note
        </Button>
      </form>
    </div>
  );
}
