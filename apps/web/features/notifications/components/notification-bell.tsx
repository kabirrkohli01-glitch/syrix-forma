'use client';

import { IconBell, IconShieldLock } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from '../actions';
import type { NotificationRow } from '../utils/queries';

/** Notification types that are about who is getting into the Hub rather than about work. */
const ACCESS_TYPES = new Set(['access_requested', 'sign_in_new_device']);

function relativeTime(value: Date): string {
  const seconds = Math.round((Date.now() - value.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function NotificationItem({
  notification,
  onRead
}: {
  notification: NotificationRow;
  onRead: (id: string) => void;
}) {
  const unread = !notification.readAt;
  const isAccess = ACCESS_TYPES.has(notification.type);

  const content = (
    <div className='flex gap-2.5'>
      <div className='pt-0.5'>
        {isAccess ? (
          <IconShieldLock className='text-muted-foreground size-4' />
        ) : (
          <span
            className={cn(
              'block size-2 rounded-full',
              unread ? 'bg-primary' : 'bg-transparent'
            )}
          />
        )}
      </div>
      <div className='min-w-0 flex-1'>
        <p className={cn('text-sm', unread && 'font-medium')}>{notification.title}</p>
        {notification.body && (
          // Bodies are assembled server-side and carry addresses and device names across more
          // than one line; preserving the breaks is what keeps them readable here.
          <p className='text-muted-foreground mt-0.5 text-xs whitespace-pre-line'>
            {notification.body}
          </p>
        )}
        <p className='text-muted-foreground mt-1 text-[11px]'>
          {relativeTime(notification.createdAt)}
        </p>
      </div>
    </div>
  );

  const className = cn(
    'block w-full rounded-lg p-2.5 text-start transition-colors',
    unread ? 'bg-muted/50 hover:bg-muted' : 'hover:bg-muted/50'
  );

  if (notification.link) {
    return (
      <Link href={notification.link} className={className} onClick={() => onRead(notification.id)}>
        {content}
      </Link>
    );
  }

  return (
    <button type='button' className={className} onClick={() => onRead(notification.id)}>
      {content}
    </button>
  );
}

/**
 * The header bell.
 *
 * The list is fetched when the popover is opened rather than rendered with the layout: these are
 * read far less often than every page load, and a layout that fetched them would put a query on
 * the critical path of every navigation to show a number that rarely changes. The unread count
 * comes from the server render, so the badge is correct before anything is opened.
 */
export function NotificationBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;

    startTransition(async () => {
      try {
        setItems(await getMyNotifications());
      } catch {
        // Left as an empty list rather than an error state: a bell that cannot load is a
        // degraded convenience, and there is nothing useful for the reader to do about it.
        setItems([]);
      }
    });
  }

  function handleRead(id: string) {
    setItems((current) =>
      current?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date() } : n)) ?? null
    );
    setUnread((count) => Math.max(0, count - 1));
    startTransition(() => markNotificationRead(id).then(() => router.refresh()));
  }

  function handleMarkAll() {
    setItems((current) => current?.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })) ?? null);
    setUnread(0);
    startTransition(() => markAllNotificationsRead().then(() => router.refresh()));
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className='relative size-8'
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            <IconBell className='size-4' />
            {unread > 0 && (
              <span className='bg-destructive text-destructive-foreground absolute -top-0.5 -end-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium'>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Button>
        }
      />

      <PopoverContent align='end' className='w-88 p-0'>
        <div className='flex items-center justify-between border-b px-3 py-2'>
          <p className='text-sm font-medium'>Notifications</p>
          {unread > 0 && (
            <Button variant='ghost' size='sm' onClick={handleMarkAll} disabled={isPending}>
              Mark all read
            </Button>
          )}
        </div>

        <ScrollArea className='max-h-96'>
          <div className='flex flex-col gap-1 p-2'>
            {items === null ? (
              <p className='text-muted-foreground p-3 text-sm'>Loading…</p>
            ) : items.length === 0 ? (
              <p className='text-muted-foreground p-3 text-sm'>Nothing to catch up on.</p>
            ) : (
              items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={handleRead}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
