import { and, eq, ne } from 'drizzle-orm';
import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { CHAT_GUIDE } from '@/config/page-guides';
import { ChatShell } from '@/features/chat/components/chat-shell';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { employeeDisplayName } from '@/lib/db/display-name';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';

export const metadata: Metadata = { title: 'Team Chat' };

// Every active employee is a valid conversation partner — Team Chat has no role/team scope
// for who you can message, only for who's already a participant of a given conversation
// (docs/permissions-matrix.md's "Implementation, Team Chat" section).
export default async function ChatPage() {
  const employee = await requireActiveEmployeeForPage();

  const messageableEmployees = await db
    .select({ id: employees.id, name: employeeDisplayName })
    .from(employees)
    .where(and(eq(employees.status, 'active'), ne(employees.id, employee.id)));

  return (
    <PageContainer
      pageTitle='Team Chat'
      pageDescription='Message anyone at the organisation, and share files.'
      infoContent={CHAT_GUIDE}
    >
      <div className='h-[calc(100dvh-9rem)] min-h-[420px]'>
        <ChatShell employees={messageableEmployees} currentEmployeeId={employee.id} />
      </div>
    </PageContainer>
  );
}
