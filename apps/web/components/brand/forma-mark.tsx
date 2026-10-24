import Image from 'next/image';
import Link from 'next/link';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function FormaMark() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' render={<Link href='/dashboard' aria-label='Go to dashboard' />}>
          <Image
            src='/forma-badge.png'
            alt=''
            width={32}
            height={32}
            className='size-8 shrink-0 rounded-lg'
            priority
          />
          <div className='grid flex-1 text-left text-sm leading-tight'>
            <span className='truncate font-semibold'>SYRIX Forma</span>
            {/* text-sidebar-foreground/70, not text-muted-foreground: that token is tuned for the
                light content surfaces and goes unreadable against the sidebar's fixed dark navy. */}
            <span className='text-sidebar-foreground/70 truncate text-xs'>
              Built by Kabirr Kohli
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
