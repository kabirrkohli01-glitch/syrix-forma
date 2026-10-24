import React from 'react';
import { SidebarTrigger } from '../ui/sidebar';
import { Separator } from '../ui/separator';
import { Breadcrumbs } from '../breadcrumbs';
import SearchInput from '../search-input';

import { ThemeModeToggle } from '../themes/theme-mode-toggle';
import { FormaAiPanelTrigger } from '@/features/forma-ai/components/forma-ai-panel';
import { NotificationBell } from '@/features/notifications/components/notification-bell';

export default function Header({ unreadNotifications }: { unreadNotifications: number }) {
  return (
    <header className='bg-background border-border sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-2 border-b md:h-14'>
      {/* The breadcrumb trail is the only part of this bar that may be truncated: `min-w-0` lets it
          shrink so a long trail cannot push the controls on the right off a narrow screen. */}
      <div className='flex min-w-0 items-center gap-2 px-4'>
        <SidebarTrigger className='-ml-1' />
        <Separator orientation='vertical' className='mr-2 h-4 data-vertical:self-center' />
        <Breadcrumbs />
      </div>

      <div className='flex shrink-0 items-center gap-2 px-4'>
        <div className='hidden md:flex'>
          <SearchInput />
        </div>
        <FormaAiPanelTrigger />
        <NotificationBell initialUnreadCount={unreadNotifications} />
        <ThemeModeToggle />
      </div>
    </header>
  );
}
