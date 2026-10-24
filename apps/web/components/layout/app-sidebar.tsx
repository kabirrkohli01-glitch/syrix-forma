'use client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { FormaMark } from '@/components/brand/forma-mark';
import { navGroups } from '@/config/nav-config';
import { clearAccessSession } from '@/features/auth/access-code-actions';
import { useClerk, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';
import type { NavItem } from '@/types';

type NavBadge = { count: number; tone: 'destructive' | 'default' };

/** Who the Hub says is signed in. Resolved server-side in the dashboard layout from the
 *  employees row, so the footer shows the name the person set in Settings rather than
 *  whatever Clerk happens to hold for the account. */
export type SidebarIdentity = { name: string; email: string };

export default function AppSidebar({
  navBadges,
  identity,
  codeMode = false
}: {
  navBadges?: Record<string, NavBadge>;
  identity: SidebarIdentity;
  /** True where the Hub was opened with a shared access code rather than an account — see
   *  lib/auth/access-code.ts. There is no Clerk session to end in that case, so the footer
   *  offers to close the code session instead of offering a sign-out that would do nothing. */
  codeMode?: boolean;
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  // Clerk is consulted for the avatar image only — the Hub has no upload of its own.
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  // On a phone the navigation is a drawer over the page, and choosing a destination from it used
  // to leave it standing open on top of the screen it had just navigated to — so every move took
  // two gestures, the second being a tap on nothing in particular. Closing is driven by the
  // pathname rather than by an onClick on each link so that it covers every way out of the drawer
  // — top-level items, the collapsible sub-items, and the footer — including a destination that
  // is reached without a click at all.
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='group-data-[collapsible=icon]:pt-4'>
        <FormaMark />
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        {navGroups.map((group, index) => (
          <SidebarGroup key={group.label || `ungrouped-${index}`} className='py-0'>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon ? Icons[item.icon] : Icons.logo;

                if (item.disabled) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <SidebarMenuButton
                              disabled
                              aria-disabled
                              className='cursor-not-allowed opacity-50'
                            />
                          }
                        >
                          <Icon />
                          <span>{item.title}</span>
                        </TooltipTrigger>
                        <TooltipContent side='right'>
                          {item.phase
                            ? `Coming in Phase ${item.phase}`
                            : 'Not available yet'}
                        </TooltipContent>
                      </Tooltip>
                    </SidebarMenuItem>
                  );
                }

                return item?.items && item?.items?.length > 0 ? (
                  <Collapsible
                    key={item.title}
                    defaultOpen={item.isActive}
                    render={<SidebarMenuItem />}
                  >
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton
                          tooltip={item.title}
                          isActive={pathname === item.url}
                          className='group/collapsible'
                        />
                      }
                    >
                      {item.icon && <Icon />}
                      <span>{item.title}</span>
                      <Icons.chevronRight className='ml-auto transition-transform duration-200 group-data-panel-open/collapsible:rotate-90' />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem: NavItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton
                              render={<Link href={subItem.url} aria-label={subItem.title} />}
                              isActive={pathname === subItem.url}
                            >
                              <span>{subItem.title}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<Link href={item.url} aria-label={item.title} />}
                      tooltip={item.title}
                      isActive={pathname === item.url}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {navBadges?.[item.url] && navBadges[item.url].count > 0 && (
                      <SidebarMenuBadge
                        className={navBadges[item.url].tone === 'destructive' ? 'text-destructive' : ''}
                      >
                        {navBadges[item.url].count}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size='lg'
                    className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
                  />
                }
              >
                <UserAvatarProfile
                  className='h-8 w-8 rounded-lg'
                  showInfo
                  name={identity.name}
                  email={identity.email}
                  imageUrl={user?.imageUrl}
                />
                <Icons.chevronsDown className='ml-auto size-4' />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--anchor-width) min-w-56 rounded-lg'
                side='bottom'
                align='end'
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='p-0 font-normal'>
                    <div className='px-1 py-1.5'>
                      <UserAvatarProfile
                        className='h-8 w-8 rounded-lg'
                        showInfo
                        name={identity.name}
                        email={identity.email}
                        imageUrl={user?.imageUrl}
                      />
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => router.push('/dashboard/settings')}>
                    <Icons.settings className='mr-2 h-4 w-4' />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={async () => {
                      if (codeMode) {
                        await clearAccessSession();
                        router.replace('/access-code');
                        router.refresh();
                        return;
                      }
                      await signOut({ redirectUrl: '/auth/sign-in' });
                    }}
                  >
                    <Icons.logout aria-hidden className='mr-2 h-4 w-4' />
                    {codeMode ? 'Lock' : 'Sign out'}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
