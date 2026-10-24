'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { FadeIn } from '@/components/motion/fade-in';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { getMessages, leaveConversation, markConversationRead } from '@/features/chat/actions';
import { AttachmentPreview } from './attachment-preview';
import { Composer } from './composer';

const MESSAGES_QUERY_KEY = (conversationId: string) => ['chat-messages', conversationId];
export const CONVERSATIONS_QUERY_KEY = ['chat-conversations'];

function initials(name: string | null) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function MessageThread({
  conversationId,
  currentEmployeeId,
  displayName,
  type = 'dm',
  onBack,
  onLeft
}: {
  conversationId: string;
  currentEmployeeId: string;
  displayName: string;
  type?: 'dm' | 'group';
  onBack?: () => void;
  onLeft?: () => void;
}) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isLeaving, startLeaving] = useTransition();
  const [leaveOpen, setLeaveOpen] = useState(false);

  function handleLeave() {
    startLeaving(async () => {
      try {
        await leaveConversation(conversationId);
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
        setLeaveOpen(false);
        onLeft?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to leave conversation');
      }
    });
  }

  const { data: messages = [], isLoading } = useQuery({
    queryKey: MESSAGES_QUERY_KEY(conversationId),
    queryFn: () => getMessages(conversationId),
    refetchInterval: 4000
  });

  useEffect(() => {
    markConversationRead(conversationId).then(() => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    });
  }, [conversationId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  function handleSent() {
    queryClient.invalidateQueries({ queryKey: MESSAGES_QUERY_KEY(conversationId) });
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
  }

  return (
    <div className='bg-background flex h-full flex-col'>
      <div className='bg-background border-border flex items-center gap-3 border-b px-4 py-3'>
        {onBack && (
          <button type='button' onClick={onBack} aria-label='Back to conversations' className='md:hidden'>
            <Icons.chevronLeft className='size-5' />
          </button>
        )}
        <Avatar className='size-9'>
          <AvatarFallback>{type === 'group' ? <Icons.teams className='size-4' /> : initials(displayName)}</AvatarFallback>
        </Avatar>
        <p className='min-w-0 flex-1 truncate font-semibold'>{displayName}</p>
        <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
          <AlertDialogTrigger render={<Button variant='ghost' size='icon-sm' aria-label='Leave conversation' />}>
            <Icons.close />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave this conversation?</AlertDialogTitle>
              <AlertDialogDescription>
                {type === 'group'
                  ? 'You will stop seeing new messages here. Other participants keep the conversation.'
                  : "You will stop seeing new messages here, and won't be notified of any this person sends afterward."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant='destructive' disabled={isLeaving} onClick={handleLeave}>
                {isLeaving ? 'Leaving…' : 'Leave'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className='flex-1 overflow-y-auto px-4 py-4'>
        {isLoading ? (
          <p className='text-muted-foreground text-sm'>Loading messages…</p>
        ) : messages.length === 0 ? (
          <Empty className='h-full border-none'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.teamChat />
              </EmptyMedia>
              <EmptyTitle>No messages yet — say hello.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className='flex flex-col gap-4'>
            {messages.map((message) => {
              const isOwn = message.authorEmployeeId === currentEmployeeId;
              return (
                <FadeIn key={message.id} className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  <Avatar className='size-7 shrink-0'>
                    <AvatarFallback className='text-[0.65rem]'>{initials(message.authorName)}</AvatarFallback>
                  </Avatar>
                  <div className={`flex max-w-md min-w-0 flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                    {!isOwn && (
                      <span className='text-muted-foreground px-1 text-xs font-medium'>
                        {message.authorName ?? 'Former employee'}
                      </span>
                    )}
                    <div
                      className={`rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        isOwn
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-muted text-foreground rounded-bl-md'
                      }`}
                    >
                      <p className='whitespace-pre-wrap break-words'>{message.body}</p>
                    </div>
                    {message.attachments.map((attachment) => (
                      <AttachmentPreview key={attachment.id} attachment={attachment} />
                    ))}
                    <span className='text-muted-foreground px-1 text-xs tabular-nums'>
                      {format(message.createdAt, 'MMM d, HH:mm')}
                    </span>
                  </div>
                </FadeIn>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <Composer conversationId={conversationId} onSent={handleSent} />
    </div>
  );
}
