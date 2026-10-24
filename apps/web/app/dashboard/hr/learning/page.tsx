import type { Metadata } from 'next';
import { HR_LEARNING_GUIDE } from '@/config/page-guides';
import PageContainer from '@/components/layout/page-container';
import { CourseCatalogue, EnrolmentList } from '@/features/hr/components/growth-panels';
import { HrTabs } from '@/features/hr/components/hr-tabs';
import {
  listCourses,
  listEnrolments,
  listGrowthSubjects
} from '@/features/hr/utils/growth-queries';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';
import { hrScopeFor } from '@/lib/permissions/hr-access';

export const metadata: Metadata = { title: 'Learning' };

export default async function LearningPage() {
  const caller = await requireActiveEmployeeForPage();

  if (hrScopeFor(caller) === 'none') {
    return (
      <PageContainer pageTitle='Learning' access={false}>
        {null}
      </PageContainer>
    );
  }

  const [courses, enrolments, subjects] = await Promise.all([
    listCourses(),
    listEnrolments(caller),
    listGrowthSubjects(caller)
  ]);

  return (
    <PageContainer
      pageTitle='Learning'
      infoContent={HR_LEARNING_GUIDE}
      pageDescription='Training assigned to you and to your reports, and the course catalogue.'
    >
      <div className='flex flex-col gap-5'>
        <HrTabs />
        <EnrolmentList enrolments={enrolments} callerId={caller.id} />
        <CourseCatalogue
          courses={courses.map((course) => ({
            id: course.id,
            title: course.title,
            provider: course.provider,
            estimatedMinutes: course.estimatedMinutes
          }))}
          subjects={subjects}
          canAssign={subjects.length > 0}
        />
      </div>
    </PageContainer>
  );
}
