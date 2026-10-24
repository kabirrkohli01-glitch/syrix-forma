import { asc, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { PROJECT_TEMPLATES_GUIDE } from '@/config/page-guides';
import { CreateTemplateDialog } from '@/features/project-templates/components/create-template-dialog';
import { TemplateCard } from '@/features/project-templates/components/template-card';
import { db } from '@/lib/db/client';
import { projectTemplateMilestones, projectTemplates, projectTemplateTasks } from '@/lib/db/schema';
import { ForbiddenError, requireRole } from '@/lib/permissions/current-employee';

export const metadata: Metadata = { title: 'Project Templates' };

export default async function ProjectTemplatesPage() {
  // Same 404-not-403 gate as Access Control / Integrations — a non-TEAM_LEAD+ gets no
  // confirmation this route exists (engineering rule 10).
  try {
    await requireRole('TEAM_LEAD', 'MANAGER', 'ADMIN');
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const templates = await db.select().from(projectTemplates).orderBy(asc(projectTemplates.name));
  const templateIds = templates.map((t) => t.id);

  const [taskRows, milestoneRows] = templateIds.length
    ? await Promise.all([
        db
          .select()
          .from(projectTemplateTasks)
          .where(inArray(projectTemplateTasks.templateId, templateIds))
          .orderBy(asc(projectTemplateTasks.position)),
        db
          .select()
          .from(projectTemplateMilestones)
          .where(inArray(projectTemplateMilestones.templateId, templateIds))
          .orderBy(asc(projectTemplateMilestones.position))
      ])
    : [[], []];

  return (
    <PageContainer
      pageTitle='Project Templates'
      pageDescription='Reusable task/milestone sets per service line — pick one when creating a project.'
      infoContent={PROJECT_TEMPLATES_GUIDE}
      pageHeaderAction={<CreateTemplateDialog />}
    >
      {templates.length === 0 ? (
        <div className='bg-card ring-foreground/10 max-w-xl rounded-2xl p-4 ring-1'>
          <p className='text-sm font-medium'>No templates yet</p>
          <p className='text-muted-foreground mt-1 text-sm'>
            Press &quot;New template&quot; and give it the tasks a project of that kind always
            needs. Due dates are entered as a number of days after the project starts, so one
            template works whatever date a project begins. Choosing it when creating a project
            copies the work straight in.
          </p>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              templateId={template.id}
              name={template.name}
              serviceLine={template.serviceLine}
              taskRows={taskRows
                .filter((t) => t.templateId === template.id)
                .map((t) => ({ id: t.id, title: t.title, relativeDueDays: t.relativeDueDays, priority: t.priority }))}
              milestoneRows={milestoneRows
                .filter((m) => m.templateId === template.id)
                .map((m) => ({ id: m.id, title: m.title, relativeDueDays: m.relativeDueDays }))}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
