import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import { getEmployeeHrRecord } from '@/features/hr/utils/queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';

export const metadata: Metadata = { title: 'Employee record' };

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  fixed_term: 'Fixed term',
  part_time: 'Part time',
  apprentice: 'Apprentice',
  contractor: 'Contractor',
  intern: 'Intern'
};

const PAY_FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  four_weekly: 'Every four weeks',
  weekly: 'Weekly'
};

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  // The column is a plain date, so parsing it as a timestamp would shift it across a timezone
  // boundary and show the wrong day for anyone west of UTC. Split the ISO date instead.
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export default async function EmployeeHrRecordPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caller = await requireActiveEmployeeForPage();

  const record = await getEmployeeHrRecord(caller, id);
  // getEmployeeHrRecord returns null both for "no such employee" and for "not yours to see",
  // and this renders the same 404 for both — a distinct 403 would confirm to an unauthorised
  // caller that a given employee id exists.
  if (!record) notFound();

  const { employment, identity, pay } = record;

  return (
    <PageContainer
      pageTitle={record.name}
      pageDescription={employment?.jobTitle ?? 'No job title recorded'}
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />

        <div className='grid gap-5 lg:grid-cols-2'>
          {employment ? (
            <ListGroup label='Employment'>
              <ListRow label='Job title' value={employment.jobTitle ?? 'Not recorded'} />
              <ListRow
                label='Contract'
                value={
                  employment.contractType
                    ? (CONTRACT_LABELS[employment.contractType] ?? employment.contractType)
                    : 'Not recorded'
                }
              />
              <ListRow label='Team' value={record.team ?? 'Unassigned'} />
              <ListRow label='Line manager' value={record.managerName ?? 'None set'} />
              <ListRow label='Start date' value={formatDate(employment.startDate)} />
              <ListRow label='Probation ends' value={formatDate(employment.probationEndDate)} />
              {employment.endDate && (
                <ListRow label='Leaving date' value={formatDate(employment.endDate)} />
              )}
              <ListRow
                label='Working pattern'
                value={
                  employment.workingDaysPerWeek || employment.workingHoursPerWeek
                    ? [
                        employment.workingDaysPerWeek && `${employment.workingDaysPerWeek} days`,
                        employment.workingHoursPerWeek && `${employment.workingHoursPerWeek} hours`
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Full time (default)'
                }
              />
            </ListGroup>
          ) : (
            <ListGroup label='Employment'>
              <ListRow
                label='Not visible to you'
                description='Job title, contract and working pattern are visible to this employee, their line manager and HR.'
                leading={<Icons.lock aria-hidden />}
              />
            </ListGroup>
          )}

          {identity ? (
            <ListGroup
              label='Personal'
              note='Special category personal data. Visible to this employee and to HR only.'
            >
              <ListRow label='Date of birth' value={formatDate(identity.dateOfBirth)} />
              <ListRow
                label='National Insurance'
                value={identity.nationalInsurance ?? 'Not recorded'}
              />
              <ListRow label='Personal email' value={identity.personalEmail ?? 'Not recorded'} />
              <ListRow label='Personal phone' value={identity.personalPhone ?? 'Not recorded'} />
              <ListRow
                label='Home address'
                description={identity.address.length > 0 ? identity.address.join(', ') : undefined}
                value={identity.address.length > 0 ? undefined : 'Not recorded'}
              />
              <ListRow
                label='Emergency contact'
                description={
                  identity.emergencyContactName
                    ? [
                        identity.emergencyContactName,
                        identity.emergencyContactRelationship,
                        identity.emergencyContactPhone
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : undefined
                }
                value={identity.emergencyContactName ? undefined : 'Not recorded'}
              />
            </ListGroup>
          ) : (
            <ListGroup label='Personal'>
              <ListRow
                label='Not visible to you'
                description='Date of birth, National Insurance number, home address and emergency contact are visible to this employee and to HR only.'
                leading={<Icons.lock aria-hidden />}
              />
            </ListGroup>
          )}
        </div>

        {pay ? (
          <ListGroup
            label='Pay'
            note='Held encrypted at rest. Changes are recorded in the audit log.'
          >
            <ListRow
              label='Annual salary'
              value={pay.annualSalary ? `${pay.currency} ${pay.annualSalary}` : 'Not recorded'}
            />
            <ListRow
              label='Hourly rate'
              value={pay.hourlyRate ? `${pay.currency} ${pay.hourlyRate}` : 'Not recorded'}
            />
            <ListRow
              label='Pay frequency'
              value={
                pay.payFrequency
                  ? (PAY_FREQUENCY_LABELS[pay.payFrequency] ?? pay.payFrequency)
                  : 'Not recorded'
              }
            />
            <ListRow label='Effective from' value={formatDate(pay.effectiveFrom)} />
          </ListGroup>
        ) : (
          <ListGroup label='Pay'>
            <ListRow
              label='Not visible to you'
              description='Salary and bank details are visible to this employee, to HR and to finance users only.'
              leading={<Icons.lock aria-hidden />}
            />
          </ListGroup>
        )}
      </div>
    </PageContainer>
  );
}
