'use client';

import { format } from 'date-fns';
import { Icons } from '@/components/icons';
import { StaggerItem, StaggerList } from '@/components/motion/stagger-list';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { SelectOption } from '@/features/chat/components/new-conversation-dialog';
import { NewConversationDialog } from '@/features/chat/components/new-conversation-dialog';
import type { ConversationSummary } from '@/features/chat/utils/queries';

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function ConversationList({
  employees,
  conversations,
  selectedId,
  onSelect,
  onCreated
}: {
  employees: SelectOption[];
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (conversationId: string, displayName: string) => void;
  onCreated: (conversationId: string) => void;
}) {
  return (
    <div className='flex h-full flex-col'>
      <div className='border-border/60 flex items-center justify-between gap-2 border-b px-4 py-3.5'>
        <p className='text-base font-semibold'>Conversations</p>
        <NewConversationDialog employees={employees} onCreated={onCreated} />
      </div>
      <div className='flex-1 overflow-y-auto px-2 py-2'>
        {conversations.length === 0 ? (
          <div className='text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-sm'>
            <Icons.teamChat className='size-6' />
            <p>No conversations yet — start one with the &quot;New&quot; button above.</p>
          </div>
        ) : (
          <StaggerList className='flex flex-col gap-0.5'>
            {conversations.map((conversation) => (
              <StaggerItem key={conversation.id}>
                <button
                  type='button'
                  onClick={() => onSelect(conversation.id, conversation.displayName)}
                  aria-label={`${conversation.displayName}${conversation.unread ? ', unread' : ''}`}
                  className={`hover:bg-muted/60 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 ${
                    selectedId === conversation.id ? 'bg-muted' : ''
                  }`}
                >
                  <Avatar className='size-10 shrink-0'>
                    <AvatarFallback>
                      {conversation.type === 'group' ? <Icons.teams className='size-4' /> : initials(conversation.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className={`truncate text-sm ${conversation.unread ? 'font-semibold' : 'font-medium'}`}>
                        {conversation.displayName}
                      </span>
                      {conversation.lastMessageAt && (
                        <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                          {format(conversation.lastMessageAt, 'MMM d')}
                        </span>
                      )}
                    </div>
                    <div className='flex items-center justify-between gap-2'>
                      {conversation.lastMessagePreview ? (
                        <p className='text-muted-foreground truncate text-xs'>{conversation.lastMessagePreview}</p>
                      ) : (
                        <span />
                      )}
                      {conversation.unread && (
                        <span className='bg-primary size-2 shrink-0 rounded-full' aria-hidden />
                      )}
                    </div>
                  </div>
                </button>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </div>
    </div>
  );
}
