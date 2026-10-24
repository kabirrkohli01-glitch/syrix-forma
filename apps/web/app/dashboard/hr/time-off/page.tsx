import type { Metadata } from 'next';
import { HR_TIME_OFF_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { BookLeaveDialog } from '@/features/hr/components/book-leave-dialog';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { LeaveBalanceCards } from '@/features/hr/components/leave-balance-cards';
import {
  LeaveApprovalQueue,
  LeaveClashList,
  LeaveRequestList
} from '@/features/hr/components/leave-request-list';
import {
  currentLeaveYear,
  getLeaveBalance,
  listClashingLeave,
  listLeaveRequestsForEmployee,
  listLeaveSubjects,
  listLeaveTypes,
  listPendingApprovals,
  upcomingLeaveWindow
} from '@/features/hr/utils/leave-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor, isHrAdmin } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Time Off' };

export default async function TimeOffPage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Time Off' access={false}>
        {null}
      </PageContainer>
    );
  }

  const year = await currentLeaveYear();
  const window = upcomingLeaveWindow();

  const [balance, myRequests, approvals, leaveTypes, subjects, clashes] = await Promise.all([
    getLeaveBalance(caller.id, year),
    listLeaveRequestsForEmployee(caller.id, year),
    listPendingApprovals(caller),
    listLeaveTypes(),
    listLeaveSubjects(caller),
    listClashingLeave(caller, window.from, window.to)
  ]);

  // HR can book on someone's behalf; a line manager approves but does not book for others.
  const canBookForOthers = isHrAdmin(caller) && subjects.length > 1;

  return (
    <PageContainer
      pageTitle='Time Off'
      infoContent={HR_TIME_OFF_GUIDE}
      pageDescription='Your allowance, your bookings, and anything waiting on your decision.'
      pageHeaderAction={
        leaveTypes.length > 0 ? (
          <BookLeaveDialog
            leaveTypes={leaveTypes.map((type) => ({
              id: type.id,
              name: type.name,
              deductsFromAllowance: type.deductsFromAllowance
            }))}
            subjects={subjects.map((s) => ({ id: s.id, name: s.name, isSelf: s.isSelf }))}
            canBookForOthers={canBookForOthers}
          />
        ) : undefined
      }
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />

        {leaveTypes.length === 0 ? (
          <p className='text-muted-foreground px-1 text-sm'>
            No leave types have been set up yet, so nothing can be booked. An HR administrator
            configures these before time off can be used.
          </p>
        ) : (
          <>
            <LeaveBalanceCards
              totalHalfDays={balance.totalHalfDays}
              takenHalfDays={balance.takenHalfDays}
              pendingHalfDays={balance.pendingHalfDays}
              availableHalfDays={balance.availableHalfDays}
              hasExplicitAllowance={balance.hasExplicitAllowance}
              year={balance.year}
            />

            <LeaveApprovalQueue requests={approvals} />
            <LeaveRequestList requests={myRequests} />
            <LeaveClashList requests={clashes} />
          </>
        )}
      </div>
    </PageContainer>
  );
}
