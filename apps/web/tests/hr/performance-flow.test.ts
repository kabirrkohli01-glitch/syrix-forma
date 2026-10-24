import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { employees, surveyResponses, surveys } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  createObjective,
  giveKudos,
  recordOneToOne,
  respondToSurvey,
  startAppraisal,
  submitManagerReview,
  submitSelfReview
} = await import('@/features/hr/performance-actions');
const { getSurveyResults, listAppraisals, listObjectives, listOneToOnes } =
  await import('@/features/hr/utils/performance-queries');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  worker: `test_${runId}_worker`,
  manager: `test_${runId}_manager`,
  stranger: `test_${runId}_stranger`,
  hr: `test_${runId}_hr`
};
const ids = { worker: '', manager: '', stranger: '', hr: '' };
let anonymousSurveyId = '';

function caller(
  key: keyof typeof clerkIds,
  overrides: Partial<ActiveEmployee> = {}
): ActiveEmployee {
  return {
    id: ids[key],
    clerkUserId: clerkIds[key],
    name: key,
    displayName: key,
    email: `${clerkIds[key]}@example.test`,
    role: 'EMPLOYEE',
    team: 'alpha',
    managerId: null,
    financeAccess: false,
    hrAdmin: false,
    ...overrides
  };
}

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.manager,
        name: 'Perf Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.stranger,
        name: 'Perf Test Stranger',
        email: `${clerkIds.stranger}@example.test`,
        role: 'TEAM_LEAD',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.hr,
        name: 'Perf Test HR',
        email: `${clerkIds.hr}@example.test`,
        role: 'HR_ADMIN',
        team: null,
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  for (const row of inserted) {
    const key = (Object.keys(clerkIds) as (keyof typeof clerkIds)[]).find(
      (k) => clerkIds[k] === row.clerkUserId
    );
    if (key) ids[key] = row.id;
  }

  const [worker] = await db
    .insert(employees)
    .values({
      clerkUserId: clerkIds.worker,
      name: 'Perf Test Worker',
      email: `${clerkIds.worker}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active',
      managerId: ids.manager
    })
    .returning({ id: employees.id });
  ids.worker = worker.id;

  const [survey] = await db
    .insert(surveys)
    .values({
      title: `Anonymous eNPS ${runId}`,
      question: 'How likely are you to recommend the organisation as a place to work?',
      isAnonymous: true
    })
    .returning({ id: surveys.id });
  anonymousSurveyId = survey.id;
});

afterAll(async () => {
  await db.delete(surveys).where(eq(surveys.id, anonymousSurveyId));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

describe('objectives', () => {
  it('lets an employee set their own', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await createObjective({ title: 'Ship the reporting module' });

    const mine = await listObjectives(caller('worker', { managerId: ids.manager }));
    expect(mine.some((o) => o.title === 'Ship the reporting module')).toBe(true);
  });

  it('lets a line manager set one for their report', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await createObjective({ employeeId: ids.worker, title: 'Complete onboarding training' });
  });

  it('refuses a same-team colleague who is not the line manager', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.stranger });
    await expect(
      createObjective({ employeeId: ids.worker, title: 'Not their business' })
    ).rejects.toThrow(/cannot set objectives/i);
  });

  it('hides one employee’s objectives from an unrelated colleague', async () => {
    const theirs = await listObjectives(caller('stranger', { role: 'TEAM_LEAD' }));
    expect(theirs.some((o) => o.employeeId === ids.worker)).toBe(false);
  });
});

describe('one-to-ones', () => {
  it('refuses someone recording a one-to-one with themselves', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(
      recordOneToOne({ employeeId: ids.worker, heldOn: '2026-06-01', sharedNotes: 'Solo' })
    ).rejects.toThrow(/cannot record a one-to-one/i);
  });

  it('lets the line manager record one with private notes', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await recordOneToOne({
      employeeId: ids.worker,
      heldOn: '2026-06-01',
      sharedNotes: 'Discussed workload',
      privateNotes: 'Considering them for a stretch project'
    });
  });

  it('shows the private notes to the manager who wrote them', async () => {
    const rows = await listOneToOnes(caller('manager', { role: 'MANAGER' }));
    const row = rows.find((r) => r.employeeId === ids.worker);
    expect(row!.sharedNotes).toBe('Discussed workload');
    expect(row!.privateNotes).toContain('stretch project');
  });

  it('withholds the private notes from the employee the notes are about', async () => {
    const rows = await listOneToOnes(caller('worker', { managerId: ids.manager }));
    const row = rows.find((r) => r.employeeId === ids.worker);
    expect(row!.sharedNotes).toBe('Discussed workload');
    expect(row!.privateNotes).toBeNull();
  });

  it('shows the private notes to HR', async () => {
    const rows = await listOneToOnes(caller('hr', { role: 'HR_ADMIN' }));
    const row = rows.find((r) => r.employeeId === ids.worker);
    expect(row!.privateNotes).toContain('stretch project');
  });
});

describe('appraisals', () => {
  let appraisalId = '';

  it('is started by the manager, not the employee', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(
      startAppraisal({ employeeId: ids.worker, cycle: '2026 mid-year' })
    ).rejects.toThrow(/cannot start an appraisal/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    const created = await startAppraisal({ employeeId: ids.worker, cycle: '2026 mid-year' });
    appraisalId = created.id;
  });

  it('refuses a duplicate for the same cycle', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await expect(
      startAppraisal({ employeeId: ids.worker, cycle: '2026 mid-year' })
    ).rejects.toThrow(/already has an appraisal/i);
  });

  it('only lets the employee write the self-review', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await expect(submitSelfReview({ appraisalId, text: 'Writing it for them' })).rejects.toThrow(
      /only the employee/i
    );

    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await submitSelfReview({ appraisalId, text: 'A good six months' });
  });

  it('only lets the manager write the manager review, and records the rating', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(
      submitManagerReview({ appraisalId, text: 'Rating myself', rating: 5 })
    ).rejects.toThrow(/cannot write the manager review/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await submitManagerReview({ appraisalId, text: 'Agreed', rating: 4 });

    const rows = await listAppraisals(caller('manager', { role: 'MANAGER' }));
    const row = rows.find((r) => r.id === appraisalId);
    expect(row!.status).toBe('complete');
    expect(row!.rating).toBe(4);
  });
});

describe('recognition', () => {
  it('refuses self-recognition', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await expect(giveKudos({ toEmployeeId: ids.worker, message: 'Well done me' })).rejects.toThrow(
      /for other people/i
    );
  });

  it('lets anyone recognise anyone else', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await giveKudos({ toEmployeeId: ids.stranger, message: 'Covered my client call at no notice' });
  });
});

describe('anonymous surveys', () => {
  it('never stores who gave which answer', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await respondToSurvey({ surveyId: anonymousSurveyId, score: 9, comment: 'Good place to work' });

    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await respondToSurvey({ surveyId: anonymousSurveyId, score: 3 });

    // Read the raw rows, bypassing every query helper: the identity must be absent from the
    // database itself, not merely filtered out on the way to the screen.
    const rows = await db
      .select()
      .from(surveyResponses)
      .where(eq(surveyResponses.surveyId, anonymousSurveyId));

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.employeeId).toBeNull();
    }
  });

  it('still produces an eNPS from the scores', async () => {
    const result = await getSurveyResults(anonymousSurveyId);
    expect(result!.responseCount).toBe(2);
    // One promoter (9) and one detractor (3) out of two responses: (1 - 1) / 2 = 0%.
    expect(result!.enps).toBe(0);
    expect(result!.averageScore).toBe(6);
  });
});
