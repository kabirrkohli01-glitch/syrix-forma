import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { courseEnrolments, courses, employees, incidents, vacancies } from '@/lib/db/schema';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const {
  assignCourse,
  convertApplicantToEmployee,
  createCourse,
  createRiskAssessment,
  createVacancy,
  moveApplicationStage,
  recordApplication,
  reportIncident,
  updateEnrolmentProgress
} = await import('@/features/hr/growth-actions');
const { listEnrolments, listIncidents } = await import('@/features/hr/utils/growth-queries');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const clerkIds = {
  worker: `test_${runId}_worker`,
  peer: `test_${runId}_peer`,
  manager: `test_${runId}_manager`,
  hr: `test_${runId}_hr`
};
const ids = { worker: '', peer: '', manager: '', hr: '' };
const createdEmails: string[] = [];
let courseId = '';
let vacancyId = '';

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
        name: 'Growth Test Manager',
        email: `${clerkIds.manager}@example.test`,
        role: 'MANAGER',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.peer,
        name: 'Growth Test Peer',
        email: `${clerkIds.peer}@example.test`,
        role: 'TEAM_LEAD',
        team: 'alpha',
        status: 'active'
      },
      {
        clerkUserId: clerkIds.hr,
        name: 'Growth Test HR',
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
      name: 'Growth Test Worker',
      email: `${clerkIds.worker}@example.test`,
      role: 'EMPLOYEE',
      team: 'alpha',
      status: 'active',
      managerId: ids.manager
    })
    .returning({ id: employees.id });
  ids.worker = worker.id;
});

afterAll(async () => {
  if (courseId) await db.delete(courses).where(eq(courses.id, courseId));
  if (vacancyId) await db.delete(vacancies).where(eq(vacancies.id, vacancyId));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
  if (createdEmails.length > 0) {
    await db.delete(employees).where(inArray(employees.email, createdEmails));
  }
});

describe('learning', () => {
  let enrolmentId = '';

  it('only lets HR add to the catalogue', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await expect(createCourse({ title: 'Not allowed' })).rejects.toThrow(/only hr/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.hr });
    const created = await createCourse({
      title: `Fire safety ${runId}`,
      provider: 'External',
      validForMonths: 12
    });
    courseId = created.id;
  });

  it('lets a line manager assign training to their report', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    const created = await assignCourse({ courseId, employeeId: ids.worker, dueOn: '2026-12-01' });
    enrolmentId = created.id;
  });

  it('refuses a colleague who is not the line manager', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await expect(assignCourse({ courseId, employeeId: ids.worker })).rejects.toThrow(
      /cannot assign training/i
    );
  });

  it('refuses a manager marking their report’s course complete for them', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await expect(updateEnrolmentProgress({ enrolmentId, progressPercent: 100 })).rejects.toThrow(
      /only the learner/i
    );
  });

  it('sets an expiry from the course validity when the learner completes it', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.worker });
    await updateEnrolmentProgress({ enrolmentId, progressPercent: 100 });

    const [row] = await db
      .select()
      .from(courseEnrolments)
      .where(eq(courseEnrolments.id, enrolmentId));

    expect(row.status).toBe('completed');
    expect(row.completedOn).not.toBeNull();
    // Valid for 12 months, so the expiry is a year after completion.
    expect(row.expiresOn).toBe(
      `${Number(row.completedOn!.slice(0, 4)) + 1}${row.completedOn!.slice(4)}`
    );
  });

  it('hides an unrelated colleague’s training', async () => {
    const rows = await listEnrolments(caller('peer', { role: 'TEAM_LEAD' }));
    expect(rows.some((r) => r.employeeId === ids.worker)).toBe(false);
  });
});

describe('health and safety', () => {
  let incidentId = '';

  it('lets anyone report, including about someone else', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    const created = await reportIncident({
      kind: 'accident',
      occurredAt: '2026-06-01T09:30',
      location: 'Stairwell',
      description: 'Slipped on a wet step',
      affectedEmployeeId: ids.worker,
      injuryDetail: 'Sprained left ankle, sent home'
    });
    incidentId = created.id;
  });

  it('shows everyone what happened but withholds the injury detail', async () => {
    const rows = await listIncidents(caller('peer', { role: 'TEAM_LEAD' }));
    const row = rows.find((r) => r.id === incidentId);

    expect(row!.description).toBe('Slipped on a wet step');
    expect(row!.location).toBe('Stairwell');
    // The reporter is not the injured person and is not HR, so the injury stays hidden.
    expect(row!.medical).toBeNull();
  });

  it('shows the injury detail to the person it happened to', async () => {
    const rows = await listIncidents(caller('worker', { managerId: ids.manager }));
    expect(rows.find((r) => r.id === incidentId)!.medical?.injuryDetail).toContain('ankle');
  });

  it('shows the injury detail to HR', async () => {
    const rows = await listIncidents(caller('hr', { role: 'HR_ADMIN' }));
    expect(rows.find((r) => r.id === incidentId)!.medical?.injuryDetail).toContain('ankle');
  });

  it('does not restrict detail on an incident involving nobody', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    const created = await reportIncident({
      kind: 'near_miss',
      occurredAt: '2026-06-02T11:00',
      description: 'Unsecured ladder left in the corridor'
    });

    const rows = await listIncidents(caller('worker', { managerId: ids.manager }));
    expect(rows.find((r) => r.id === created.id)!.medical).not.toBeNull();
  });

  it('never guesses RIDDOR reportability', async () => {
    const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId));
    expect(row.riddorReportable).toBe(false);
  });

  it('bands a risk assessment from likelihood and severity', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr });
    const low = await createRiskAssessment({
      title: 'Paper cuts',
      hazard: 'Handling documents',
      likelihood: 2,
      severity: 1,
      assessedOn: '2026-06-01'
    });
    expect(low.level).toBe('low');

    const high = await createRiskAssessment({
      title: 'Working at height',
      hazard: 'Changing ceiling lights',
      likelihood: 4,
      severity: 5,
      assessedOn: '2026-06-01'
    });
    expect(high.level).toBe('high');
  });
});

describe('recruitment', () => {
  let applicationId = '';

  it('only lets HR open a vacancy', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await expect(createVacancy({ title: 'Not allowed' })).rejects.toThrow(/only hr/i);

    mockAuth.mockResolvedValue({ userId: clerkIds.hr });
    const created = await createVacancy({
      title: `Analyst ${runId}`,
      hiringManagerEmployeeId: ids.manager
    });
    vacancyId = created.id;
  });

  it('lets the hiring manager add a candidate', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    const created = await recordApplication({
      vacancyId,
      candidateName: 'Test Candidate',
      candidateEmail: `candidate_${runId}@example.test`,
      appliedOn: '2026-06-01'
    });
    applicationId = created.id;
    createdEmails.push(`candidate_${runId}@example.test`);
  });

  it('refuses an unrelated colleague', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.peer });
    await expect(
      recordApplication({
        vacancyId,
        candidateName: 'Another',
        candidateEmail: `other_${runId}@example.test`,
        appliedOn: '2026-06-01'
      })
    ).rejects.toThrow(/cannot add candidates/i);
  });

  it('refuses the same candidate applying twice for one vacancy', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await expect(
      recordApplication({
        vacancyId,
        candidateName: 'Test Candidate',
        candidateEmail: `candidate_${runId}@example.test`,
        appliedOn: '2026-06-02'
      })
    ).rejects.toThrow(/already applied/i);
  });

  it('will not create an employee record before the candidate is hired', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr });
    await expect(convertApplicantToEmployee({ applicationId })).rejects.toThrow(
      /move the candidate to hired/i
    );
  });

  it('refuses the hiring manager creating the employee record', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.manager });
    await moveApplicationStage({ applicationId, stage: 'hired' });
    await expect(convertApplicantToEmployee({ applicationId })).rejects.toThrow(/only hr/i);
  });

  it('creates a pending employee with no role when HR converts', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr });
    const { employeeId } = await convertApplicantToEmployee({ applicationId });

    const [row] = await db.select().from(employees).where(eq(employees.id, employeeId));
    // Pending and role-less: the new starter goes through the normal approval path rather
    // than arriving with permissions already attached.
    expect(row.status).toBe('pending');
    expect(row.role).toBeNull();
    expect(row.email).toBe(`candidate_${runId}@example.test`);
  });

  it('refuses to convert the same candidate twice', async () => {
    mockAuth.mockResolvedValue({ userId: clerkIds.hr });
    await expect(convertApplicantToEmployee({ applicationId })).rejects.toThrow(/already exists/i);
  });
});
