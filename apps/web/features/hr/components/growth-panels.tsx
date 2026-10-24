'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListGroup, ListRow } from '@/components/ui/list-group';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  assignCourse,
  convertApplicantToEmployee,
  moveApplicationStage,
  recordApplication,
  reportIncident,
  updateEnrolmentProgress
} from '@/features/hr/growth-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type { ApplicationRow, EnrolmentRow, IncidentRow } from '@/features/hr/utils/growth-queries';

type SubjectOption = { id: string; name: string; isSelf: boolean; isReport: boolean };

// --- Learning ---

export function CourseCatalogue({
  courses,
  subjects,
  canAssign
}: {
  courses: {
    id: string;
    title: string;
    provider: string | null;
    estimatedMinutes: number | null;
  }[];
  subjects: SubjectOption[];
  canAssign: boolean;
}) {
  if (courses.length === 0) {
    return (
      <ListGroup
        label='Course catalogue'
        note='The platform is here; the courses are not. Breathe bundles a library of licensed courses that cannot be copied, so the organisation adds its own or links to a provider.'
      >
        <ListRow
          label='No courses yet'
          description='An HR administrator adds courses, which can then be assigned to people or required of a whole team.'
          leading={<Icons.learning aria-hidden />}
        />
      </ListGroup>
    );
  }

  return (
    <ListGroup label='Course catalogue'>
      {courses.map((course) => (
        <ListRow
          key={course.id}
          label={course.title}
          description={[
            course.provider,
            course.estimatedMinutes ? `${course.estimatedMinutes} min` : null
          ]
            .filter(Boolean)
            .join(' · ')}
          leading={<Icons.learning aria-hidden />}
          action={
            canAssign ? <AssignCourseButton courseId={course.id} subjects={subjects} /> : undefined
          }
        />
      ))}
    </ListGroup>
  );
}

function AssignCourseButton({
  courseId,
  subjects
}: {
  courseId: string;
  subjects: SubjectOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [employeeId, setEmployeeId] = React.useState(subjects[0]?.id ?? '');
  const [dueOn, setDueOn] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='ghost' size='sm' />}>Assign</DialogTrigger>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Assign this course</DialogTitle>
          <DialogDescription>They are notified and it appears in their training.</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`assign-${courseId}`}>To</Label>
            <NativeSelect
              className='w-full'
              id={`assign-${courseId}`}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isSelf ? `${s.name} (you)` : s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`assign-due-${courseId}`}>Due by</Label>
            <Input
              id={`assign-due-${courseId}`}
              type='date'
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!employeeId || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await assignCourse({ courseId, employeeId, dueOn: dueOn || undefined });
                  toast.success('Assigned');
                  setOpen(false);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EnrolmentList({
  enrolments,
  callerId
}: {
  enrolments: EnrolmentRow[];
  callerId: string;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function setProgress(id: string, progressPercent: number) {
    setPendingId(id);
    updateEnrolmentProgress({ enrolmentId: id, progressPercent })
      .then(() => toast.success(progressPercent >= 100 ? 'Marked complete' : 'Progress saved'))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  return (
    <ListGroup label='Training'>
      {enrolments.length === 0 ? (
        <ListRow
          label='Nothing assigned'
          description='Courses assigned to you or to your reports appear here with their due dates.'
          leading={<Icons.certificate aria-hidden />}
        />
      ) : (
        enrolments.map((enrolment) => (
          <ListRow
            key={enrolment.id}
            label={`${enrolment.courseTitle}${
              enrolment.employeeId === callerId ? '' : ` · ${enrolment.employeeName}`
            }`}
            description={[
              enrolment.dueOn ? `due ${enrolment.dueOn}` : null,
              enrolment.expiresOn ? `expires ${enrolment.expiresOn}` : null,
              `${enrolment.progressPercent}%`
            ]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.certificate aria-hidden />}
            value={<Badge variant='outline'>{enrolment.status.replaceAll('_', ' ')}</Badge>}
            action={
              enrolment.employeeId === callerId && enrolment.status !== 'completed' ? (
                <span className='flex gap-1'>
                  {enrolment.externalUrl && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        window.open(enrolment.externalUrl!, '_blank', 'noopener,noreferrer')
                      }
                    >
                      Open
                    </Button>
                  )}
                  <Button
                    size='sm'
                    disabled={pendingId === enrolment.id}
                    onClick={() => setProgress(enrolment.id, 100)}
                  >
                    Mark done
                  </Button>
                </span>
              ) : undefined
            }
          />
        ))
      )}
    </ListGroup>
  );
}

// --- Health and safety ---

const INCIDENT_KINDS = [
  { value: 'near_miss', label: 'Near miss' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'accident', label: 'Accident' },
  { value: 'ill_health', label: 'Work-related ill health' },
  { value: 'dangerous_occurrence', label: 'Dangerous occurrence' }
] as const;

export function ReportIncidentDialog({ subjects }: { subjects: SubjectOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState<string>('near_miss');
  const [occurredAt, setOccurredAt] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [affectedEmployeeId, setAffectedEmployeeId] = React.useState('');
  const [injuryDetail, setInjuryDetail] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Icons.add aria-hidden />
        Report
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Report an incident</DialogTitle>
          <DialogDescription>
            Anyone can report anything here, including a near miss where nothing went wrong.
            Under-reporting is the problem a safety log exists to solve.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='incident-kind'>What kind</Label>
            <NativeSelect
              className='w-full'
              id='incident-kind'
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {INCIDENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='incident-when'>When</Label>
              <Input
                id='incident-when'
                type='datetime-local'
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='incident-where'>Where</Label>
              <Input
                id='incident-where'
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='incident-what'>What happened</Label>
            <Textarea
              id='incident-what'
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='incident-who'>Anyone hurt or involved</Label>
            <NativeSelect
              className='w-full'
              id='incident-who'
              value={affectedEmployeeId}
              onChange={(e) => setAffectedEmployeeId(e.target.value)}
            >
              <option value=''>Nobody</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isSelf ? `${s.name} (you)` : s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {affectedEmployeeId && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='incident-injury'>Injury detail</Label>
              <Textarea
                id='incident-injury'
                rows={2}
                value={injuryDetail}
                onChange={(e) => setInjuryDetail(e.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                Health information. Visible to the person involved and to HR only — everyone else
                sees that an incident happened and what was done about it.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!occurredAt || !description.trim() || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await reportIncident({
                    kind: kind as 'accident',
                    occurredAt,
                    location: location.trim() || undefined,
                    description: description.trim(),
                    affectedEmployeeId: affectedEmployeeId || undefined,
                    injuryDetail: injuryDetail.trim() || undefined
                  });
                  toast.success('Reported — HR has been notified');
                  setOpen(false);
                  setDescription('');
                  setInjuryDetail('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Reporting…' : 'Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IncidentLog({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <ListGroup
      label='Incident log'
      note='Everyone can see what happened and what changed as a result. Injury detail stays with the person involved and HR.'
    >
      {incidents.length === 0 ? (
        <ListRow
          label='Nothing reported'
          description='Accidents, near misses and hazards reported by anyone appear here.'
          leading={<Icons.safety aria-hidden />}
        />
      ) : (
        incidents.map((incident) => (
          <ListRow
            key={incident.id}
            label={`${incident.kind.replaceAll('_', ' ')}${
              incident.location ? ` · ${incident.location}` : ''
            }`}
            description={[
              incident.occurredAt.toISOString().slice(0, 10),
              incident.description,
              incident.medical?.injuryDetail ?? undefined
            ]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.safety aria-hidden />}
            value={
              <span className='flex items-center gap-1.5'>
                {incident.riddorReportable && <Badge variant='destructive'>RIDDOR</Badge>}
                <Badge variant='outline'>{incident.closedAt ? 'closed' : 'open'}</Badge>
              </span>
            }
          />
        ))
      )}
    </ListGroup>
  );
}

export function RiskAssessmentList({
  assessments
}: {
  assessments: {
    id: string;
    title: string;
    location: string | null;
    level: string;
    reviewDueOn: string | null;
  }[];
}) {
  return (
    <ListGroup label='Risk assessments'>
      {assessments.length === 0 ? (
        <ListRow
          label='None recorded'
          description='A risk assessment records a hazard, who it affects, and the controls in place.'
          leading={<Icons.warning aria-hidden />}
        />
      ) : (
        assessments.map((assessment) => (
          <ListRow
            key={assessment.id}
            label={assessment.title}
            description={[
              assessment.location,
              assessment.reviewDueOn ? `review due ${assessment.reviewDueOn}` : null
            ]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.warning aria-hidden />}
            value={
              <Badge variant={assessment.level === 'high' ? 'destructive' : 'outline'}>
                {assessment.level} risk
              </Badge>
            }
          />
        ))
      )}
    </ListGroup>
  );
}

export function SafetyRoleList({
  roles
}: {
  roles: { id: string; employeeName: string; roleName: string; expiresOn: string | null }[];
}) {
  if (roles.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ListGroup
      label='Safety roles'
      note='Certifications that lapse unnoticed are the point of this list.'
    >
      {roles.map((role) => (
        <ListRow
          key={role.id}
          label={`${role.roleName} · ${role.employeeName}`}
          description={role.expiresOn ? `Expires ${role.expiresOn}` : 'No expiry recorded'}
          leading={<Icons.certificate aria-hidden />}
          value={
            role.expiresOn && role.expiresOn < today ? (
              <Badge variant='destructive'>expired</Badge>
            ) : undefined
          }
        />
      ))}
    </ListGroup>
  );
}

// --- Recruitment ---

const STAGES = [
  'applied',
  'shortlisted',
  'interviewing',
  'offered',
  'hired',
  'rejected',
  'withdrawn'
] as const;

export function VacancyList({
  vacancies,
  canManage
}: {
  vacancies: {
    id: string;
    title: string;
    team: string | null;
    status: string;
    closesOn: string | null;
  }[];
  canManage: boolean;
}) {
  return (
    <ListGroup
      label='Vacancies'
      note={
        canManage
          ? undefined
          : 'Open roles across the organisation. Applications are visible to HR and the hiring manager.'
      }
    >
      {vacancies.length === 0 ? (
        <ListRow
          label='No open vacancies'
          description='Roles opened by HR appear here for everyone, so internal moves and referrals are possible.'
          leading={<Icons.hiring aria-hidden />}
        />
      ) : (
        vacancies.map((vacancy) => (
          <ListRow
            key={vacancy.id}
            label={vacancy.title}
            description={[vacancy.team, vacancy.closesOn ? `closes ${vacancy.closesOn}` : null]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.hiring aria-hidden />}
            value={<Badge variant='outline'>{vacancy.status}</Badge>}
          />
        ))
      )}
    </ListGroup>
  );
}

export function ApplicationList({
  applications,
  vacancies,
  canConvert
}: {
  applications: ApplicationRow[];
  vacancies: { id: string; title: string }[];
  canConvert: boolean;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function move(id: string, stage: (typeof STAGES)[number]) {
    setPendingId(id);
    moveApplicationStage({ applicationId: id, stage })
      .then(() => toast.success(`Moved to ${stage}`))
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  return (
    <ListGroup
      label='Candidates'
      note='Candidates are not employees and hold no account. Hiring one creates a pending employee record as a separate, deliberate step.'
    >
      {applications.length === 0 ? (
        <ListRow
          label='No applications'
          description='Candidates recorded against a vacancy appear here.'
          leading={<Icons.user aria-hidden />}
        />
      ) : (
        applications.map((application) => (
          <ListRow
            key={application.id}
            label={`${application.candidateName} · ${application.vacancyTitle}`}
            description={[
              application.candidateEmail,
              `applied ${application.appliedOn}`,
              application.interviewCount > 0 ? `${application.interviewCount} interview(s)` : null
            ]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.user aria-hidden />}
            action={
              <span className='flex items-center gap-1'>
                <NativeSelect
                  aria-label={`Stage for ${application.candidateName}`}
                  size='sm'
                  value={application.stage}
                  disabled={pendingId === application.id}
                  onChange={(e) => move(application.id, e.target.value as (typeof STAGES)[number])}
                >
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </NativeSelect>
                {canConvert &&
                  application.stage === 'hired' &&
                  !application.convertedEmployeeId && (
                    <Button
                      size='sm'
                      disabled={pendingId === application.id}
                      onClick={() => {
                        setPendingId(application.id);
                        convertApplicantToEmployee({ applicationId: application.id })
                          .then(() => toast.success('Employee record created, pending approval'))
                          .catch((error: unknown) => toast.error(hrErrorMessage(error)))
                          .finally(() => setPendingId(null));
                      }}
                    >
                      Create record
                    </Button>
                  )}
              </span>
            }
          />
        ))
      )}
      {vacancies.length > 0 && <AddCandidateDialog vacancies={vacancies} />}
    </ListGroup>
  );
}

function AddCandidateDialog({ vacancies }: { vacancies: { id: string; title: string }[] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [vacancyId, setVacancyId] = React.useState(vacancies[0]?.id ?? '');
  const [candidateName, setCandidateName] = React.useState('');
  const [candidateEmail, setCandidateEmail] = React.useState('');
  const [appliedOn, setAppliedOn] = React.useState(new Date().toISOString().slice(0, 10));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type='button'
            aria-label='Add a candidate'
            className='hover:bg-muted/60 w-full px-4 py-3 text-start'
          />
        }
      >
        <span className='text-primary text-sm font-medium'>+ Add a candidate</span>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Add a candidate</DialogTitle>
          <DialogDescription>
            Recording a candidate stores personal data about someone outside the company — it
            carries its own retention rules.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cand-vacancy'>Vacancy</Label>
            <NativeSelect
              className='w-full'
              id='cand-vacancy'
              value={vacancyId}
              onChange={(e) => setVacancyId(e.target.value)}
            >
              {vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cand-name'>Name</Label>
            <Input
              id='cand-name'
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cand-email'>Email</Label>
            <Input
              id='cand-email'
              type='email'
              value={candidateEmail}
              onChange={(e) => setCandidateEmail(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cand-applied'>Applied on</Label>
            <Input
              id='cand-applied'
              type='date'
              value={appliedOn}
              onChange={(e) => setAppliedOn(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!vacancyId || !candidateName.trim() || !candidateEmail.trim() || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await recordApplication({
                    vacancyId,
                    candidateName: candidateName.trim(),
                    candidateEmail: candidateEmail.trim(),
                    appliedOn
                  });
                  toast.success('Candidate added');
                  setOpen(false);
                  setCandidateName('');
                  setCandidateEmail('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
