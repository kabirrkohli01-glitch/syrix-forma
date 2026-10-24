import type { Metadata } from 'next';
import { HR_EXPENSES_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { ExpenseClaimList, NewClaimButton } from '@/features/hr/components/expense-panels';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { listExpenseCategories, listExpenseClaims } from '@/features/hr/utils/work-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { canMarkExpensePaid, hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Expenses' };

export default async function ExpensesPage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Expenses' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [claims, categories] = await Promise.all([
    listExpenseClaims(caller),
    listExpenseCategories()
  ]);

  return (
    <PageContainer
      pageTitle='Expenses'
      infoContent={HR_EXPENSES_GUIDE}
      pageDescription={
        caller.financeAccess
          ? 'Every claim across the company, and what is waiting to be paid.'
          : 'Your claims, and anything waiting on your approval.'
      }
      pageHeaderAction={<NewClaimButton />}
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <ExpenseClaimList
          claims={claims}
          categories={categories.map((category) => ({
            id: category.id,
            name: category.name,
            isMileage: category.isMileage,
            warnOverPence: category.warnOverPence
          }))}
          callerId={caller.id}
          canPay={canMarkExpensePaid(caller)}
        />
      </div>
    </PageContainer>
  );
}
