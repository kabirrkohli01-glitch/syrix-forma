import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfoSidebar } from '@/components/layout/info-sidebar';
import { RouteTransition } from '@/components/motion/route-transition';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { countUnreadConversationsForEmployee } from '@/features/chat/utils/queries';
import { FormaAiPanelProvider } from '@/features/forma-ai/components/forma-ai-panel';
import { ConversationProvider } from '@/features/forma-ai/store/conversation';
import { countUnreadNotifications } from '@/features/notifications/utils/queries';
import { countOverdueTasksForEmployee } from '@/features/tasks/utils/counts';
import { ACCESS_CODE_PATH, accessCodeModeEnabled } from '@/lib/auth/access-code-config';
import { isCurrentlyLockedOut } from '@/lib/auth/lockout';
import { recordSignIn } from '@/lib/auth/sign-in-events';
import { resolveDisplayName } from '@/lib/db/display-name';
import { getEmployeeRow } from '@/lib/permissions/current-employee';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: {
    default: 'SYRIX Forma',
    template: '%s | SYRIX Forma'
  }
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Which gate applies depends on how this deployment authenticates. On a shared access code
  // there is no Clerk session to protect with, and proxy.ts has already refused every request
  // that arrived without a valid code session.
  const codeMode = accessCodeModeEnabled();

  // Gate the whole /dashboard segment: redirect to sign-in when signed out.
  const sessionId = codeMode ? null : (await auth.protect()).sessionId;

  // Session-level auth alone isn't enough: a signed-in Clerk user with no active SYRIX Forma
  // employee record (not yet approved, or offboarded) must never reach real app data.
  const employee = await getEmployeeRow();
  if (!employee) redirect(codeMode ? ACCESS_CODE_PATH : '/onboarding');

  // Recorded before the status redirects rather than after, because a session that is about to
  // be turned away is the one an administrator most needs to hear about. Awaited rather than
  // left running, since a redirect() below would otherwise abandon it mid-flight.
  //
  // Skipped under an access code: every session there is the same account, so the record would
  // answer "was this you?" with the only answer it can ever give, and the alert it raises goes
  // out by email — which a demonstration deployment is deliberately not able to send.
  if (sessionId) await recordSignIn(employee, sessionId);

  if (employee.status === 'pending') redirect('/onboarding');
  if (employee.status === 'rejected') redirect('/access-refused');
  if (employee.status === 'disabled') redirect('/access-disabled');

  // Held out even with a valid session. Clerk's own lockout expires on a fixed timer; this one
  // lengthens with each repeat, so it has to be enforced here rather than left to the identity
  // provider — otherwise the second and third lockouts would end as quickly as the first.
  if (isCurrentlyLockedOut(employee)) redirect('/access-locked');

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';

  // Counts back the sidebar's nav badges — same underlying definitions as the dashboard's own
  // Overdue card and Team Chat's unread indicator, just as lean COUNT queries instead of full
  // row fetches, since a badge only ever needs the number.
  const [overdueTaskCount, unreadChatCount, unreadNotifications] = await Promise.all([
    countOverdueTasksForEmployee(employee.id),
    countUnreadConversationsForEmployee(employee.id),
    countUnreadNotifications(employee.id)
  ]);
  const navBadges: Record<string, { count: number; tone: 'destructive' | 'default' }> = {
    '/dashboard/my-work': { count: overdueTaskCount, tone: 'destructive' },
    '/dashboard/chat': { count: unreadChatCount, tone: 'default' }
  };

  return (
    <KBar>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href='#main-content'
          className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
        >
          Skip to content
        </a>
        <AppSidebar
          navBadges={navBadges}
          identity={{ name: resolveDisplayName(employee), email: employee.email }}
          codeMode={codeMode}
        />
        <SidebarInset id='main-content' tabIndex={-1} className='scroll-mt-16'>
          {/* SYRIX AI's conversation lives above the route so the side panel and the
              /dashboard/forma-ai tab share one conversation, and navigating between
              pages does not discard a question mid-answer. It is memory-only: see
              features/forma-ai/store/conversation.tsx. */}
          <ConversationProvider>
            <FormaAiPanelProvider>
              <Header unreadNotifications={unreadNotifications} />
              <InfobarProvider defaultOpen={false}>
                <RouteTransition>{children}</RouteTransition>
                <InfoSidebar side='right' />
              </InfobarProvider>
            </FormaAiPanelProvider>
          </ConversationProvider>
        </SidebarInset>
      </SidebarProvider>
    </KBar>
  );
}
