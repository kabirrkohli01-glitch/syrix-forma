'use client';

import { useState, useTransition } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addTaskComment, removeTaskComment } from '@/features/tasks/comments-actions';

export type TaskCommentRow = {
  id: string;
  body: string;
  authorEmployeeId: string | null;
  authorName: string;
  createdAt: Date;
};

export function CommentsCard({
  taskId,
  comments,
  currentEmployeeId
}: {
  taskId: string;
  comments: TaskCommentRow[];
  currentEmployeeId: string;
}) {
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await addTaskComment(taskId, { body: body.trim() });
        setBody('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add comment');
      }
    });
  }

  function handleRemove(commentId: string) {
    startTransition(async () => {
      try {
        await removeTaskComment(commentId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove comment');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      {comments.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No comments yet.</p>
      ) : (
        <ul className='flex flex-col gap-3'>
          {comments.map((comment) => (
            <li key={comment.id} className='flex flex-col gap-1 rounded-lg border p-2.5 text-sm'>
              <div className='flex items-center justify-between gap-2'>
                <span className='font-medium'>{comment.authorName}</span>
                <div className='flex items-center gap-2'>
                  <span className='text-muted-foreground text-xs'>
                    {format(comment.createdAt, 'MMM d, yyyy HH:mm')}
                  </span>
                  {comment.authorEmployeeId === currentEmployeeId && (
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      disabled={isPending}
                      onClick={() => handleRemove(comment.id)}
                      aria-label='Remove comment'
                    >
                      <Icons.close className='size-3.5' />
                    </Button>
                  )}
                </div>
              </div>
              <p className='whitespace-pre-wrap'>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className='flex flex-col gap-2'>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder='Add a comment'
          maxLength={5000}
          rows={2}
        />
        <Button type='submit' size='sm' className='self-end' disabled={isPending || !body.trim()}>
          Comment
        </Button>
      </form>
    </div>
  );
}
