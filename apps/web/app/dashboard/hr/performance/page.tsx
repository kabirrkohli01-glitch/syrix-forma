import type { Metadata } from 'next';
import { HR_PERFORMANCE_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { Icons } from '@/components/icons';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import {
  AppraisalList,
  KudosWall,
  ObjectiveList,
  OneToOneList,
  SurveyPrompt
} from '@/features/hr/components/performance-panels';
import {
  listAppraisals,
  listCompanyGoals,
  listKudos,
  listObjectives,
  listOneToOnes,
  listOpenSurveys,
  listPerformanceSubjects
} from '@/features/hr/utils/performance-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Performance' };

export default async function PerformancePage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Performance' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [goals, objectives, oneToOnes, appraisals, kudosEntries, surveys, subjects] =
    await Promise.all([
      listCompanyGoals(),
      listObjectives(caller),
      listOneToOnes(caller),
      listAppraisals(caller),
      listKudos(),
      listOpenSurveys(),
      listPerformanceSubjects(caller)
    ]);

  const openSurvey = surveys[0];

  return (
    <PageContainer
      pageTitle='Performance'
      infoContent={HR_PERFORMANCE_GUIDE}
      pageDescription='Company goals, objectives, one-to-ones, appraisals and recognition.'
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />

        {openSurvey && (
          <SurveyPrompt
            survey={{
              id: openSurvey.id,
              title: openSurvey.title,
              question: openSurvey.question,
              isAnonymous: openSurvey.isAnonymous
            }}
          />
        )}

        <div className='grid gap-5 lg:grid-cols-2'>
          <ListGroup label='Company goals' note='Published to everyone. Set by HR.'>
            {goals.length === 0 ? (
              <ListRow
                label='None published'
                description='Company goals give individual objectives something to align to.'
                leading={<Icons.goal aria-hidden />}
              />
            ) : (
              goals.map((goal) => (
                <ListRow
                  key={goal.id}
                  label={goal.title}
                  description={
                    goal.dueDate ? `Due ${goal.dueDate}` : (goal.description ?? undefined)
                  }
                  leading={<Icons.goal aria-hidden />}
                  value={<Badge variant='outline'>{goal.status.replaceAll('_', ' ')}</Badge>}
                />
              ))
            )}
          </ListGroup>

          <ObjectiveList
            objectives={objectives}
            subjects={subjects}
            goals={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
          />
        </div>

        <div className='grid gap-5 lg:grid-cols-2'>
          <OneToOneList oneToOnes={oneToOnes} subjects={subjects} />
          <KudosWall entries={kudosEntries} subjects={subjects} />
        </div>

        <AppraisalList appraisals={appraisals} callerId={caller.id} />
      </div>
    </PageContainer>
  );
}
