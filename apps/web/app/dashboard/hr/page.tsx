import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { HR_PEOPLE_GUIDE } from '@/config/page-guides';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { listVisibleEmployees } from '@/features/hr/utils/queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'HR' };

export default async function HrPeoplePage() {
  const caller = await requireActiveEmployeeForPage();
  const scope = hrScopeFor(caller);

  if (scope === 'none') {
    return (
      <PageContainer pageTitle='HR' access={false}>
        {null}
      </PageContainer>
    );
  }

  const people = await listVisibleEmployees(caller);
  const self = people.find((person) => person.isSelf);
  const others = people.filter((person) => !person.isSelf);

  // What the caller is looking at depends entirely on their scope, and saying so up front is
  // the difference between "this list looks short" and "this list is my direct reports"
  // (engineering rule 17).
  const description =
    scope === 'all'
      ? 'Everyone at the organisation, their employment record, and the detail only HR can see.'
      : 'Your own record, and the people who report to you.';

  return (
    <PageContainer pageTitle='HR' pageDescription={description} infoContent={HR_PEOPLE_GUIDE}>
      <div className='flex flex-col gap-5'>
        <HrTabs />

        {self && (
          <ListGroup label='You'>
            <ListRow
              label={self.name}
              description={self.jobTitle ?? 'No job title recorded'}
              leading={<Icons.account aria-hidden />}
              href={`/dashboard/hr/people/${self.id}`}
            />
          </ListGroup>
        )}

        {others.length > 0 ? (
          <ListGroup
            label={scope === 'all' ? 'Everyone' : 'Your reports'}
            note={
              scope === 'all'
                ? 'Date of birth, National Insurance number, home address and pay are visible to HR only.'
                : 'As a line manager you can see employment detail. Identity and pay detail stay with HR.'
            }
          >
            {others.map((person) => (
              <ListRow
                key={person.id}
                label={person.name}
                description={person.jobTitle ?? 'No job title recorded'}
                leading={<Icons.user aria-hidden />}
                value={person.team ? <Badge variant='secondary'>{person.team}</Badge> : undefined}
                href={`/dashboard/hr/people/${person.id}`}
              />
            ))}
          </ListGroup>
        ) : (
          <p className='text-muted-foreground px-1 text-sm'>
            {scope === 'all'
              ? 'No employee records yet.'
              : 'Nobody reports to you, so there is nothing else to show here.'}
          </p>
        )}
      </div>
    </PageContainer>
  );
}
