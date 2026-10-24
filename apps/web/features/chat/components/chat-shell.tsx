'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { getMyConversations } from '@/features/chat/actions';
import type { SelectOption } from '@/features/chat/components/new-conversation-dialog';
import { ConversationList } from './conversation-list';
import { CONVERSATIONS_QUERY_KEY, MessageThread } from './message-thread';

/**
 * Desktop: list + thread side by side, matching every other two-pane view in this app.
 * Mobile: one pane at a time (Section 3) — the thread replaces the list until "back" is tapped.
 */
export function ChatShell({
  employees,
  currentEmployeeId
}: {
  employees: SelectOption[];
  currentEmployeeId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: getMyConversations,
    refetchInterval: 6000
  });

  const selected = conversations.find((c) => c.id === selectedId);

  function handleCreated(conversationId: string) {
    setSelectedId(conversationId);
  }

  return (
    <>
      {/* Narrow screens: one pane at a time, the thread replacing the list until "back" is tapped.
          Which arrangement applies is decided in CSS rather than by measuring the viewport in
          JavaScript. A media-query hook cannot know the width during server rendering and has to
          assume one — it assumed desktop, so a phone was served the 300px + thread two-pane grid
          and re-rendered to a single pane only once hydration ran. That produced a visible jump on
          every load, a horizontal overflow while it lasted, and a hydration mismatch warning. Both
          arrangements are rendered here and the correct one is shown at the breakpoint, so the
          first paint is already right. */}
      <div className='h-full md:hidden'>
        {selectedId ? (
          <MessageThread
            conversationId={selectedId}
            currentEmployeeId={currentEmployeeId}
            displayName={selected?.displayName ?? ''}
            type={selected?.type}
            onBack={() => setSelectedId(null)}
            onLeft={() => setSelectedId(null)}
          />
        ) : (
          <ConversationList
            employees={employees}
            conversations={conversations}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onCreated={handleCreated}
          />
        )}
      </div>

      <div className='border-border bg-card hidden h-full grid-cols-[300px_1fr] overflow-hidden rounded-lg border md:grid'>
      <div className='bg-muted/20 border-border border-r'>
        <ConversationList
          employees={employees}
          conversations={conversations}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onCreated={handleCreated}
        />
      </div>
      <div>
        {selectedId ? (
          <MessageThread
            conversationId={selectedId}
            currentEmployeeId={currentEmployeeId}
            displayName={selected?.displayName ?? ''}
            type={selected?.type}
            onLeft={() => setSelectedId(null)}
          />
        ) : (
          <Empty className='h-full border-none'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.teamChat />
              </EmptyMedia>
              <EmptyTitle>Pick a conversation, or start a new one.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      </div>
    </>
  );
}
