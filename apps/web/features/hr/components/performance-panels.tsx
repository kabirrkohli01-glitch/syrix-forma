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
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  createObjective,
  giveKudos,
  recordOneToOne,
  respondToSurvey,
  submitManagerReview,
  submitSelfReview,
  updateObjective
} from '@/features/hr/performance-actions';
import { hrErrorMessage } from '@/features/hr/utils/errors';
import type {
  AppraisalRow,
  ObjectiveRow,
  OneToOneRow
} from '@/features/hr/utils/performance-queries';

type SubjectOption = { id: string; name: string; isSelf: boolean; isReport: boolean };

const STATUSES = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'achieved', label: 'Achieved' },
  { value: 'missed', label: 'Missed' },
  { value: 'cancelled', label: 'Cancelled' }
] as const;

export function ObjectiveList({
  objectives,
  subjects,
  goals
}: {
  objectives: ObjectiveRow[];
  subjects: SubjectOption[];
  goals: { id: string; title: string }[];
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function setStatus(id: string, status: string) {
    setPendingId(id);
    updateObjective({ objectiveId: id, status: status as ObjectiveRow['status'] })
      .catch((error: unknown) => toast.error(hrErrorMessage(error)))
      .finally(() => setPendingId(null));
  }

  return (
    <ListGroup
      label='Objectives'
      note={
        objectives.length > 0
          ? 'Objectives aligned to a company goal show it underneath.'
          : undefined
      }
    >
      {objectives.length === 0 ? (
        <ListRow
          label='No objectives set'
          description='Objectives you or your manager set appear here, with their progress.'
          leading={<Icons.goal aria-hidden />}
        />
      ) : (
        objectives.map((objective) => (
          <ListRow
            key={objective.id}
            label={objective.title}
            description={[
              objective.employeeName,
              objective.companyGoalTitle ? `→ ${objective.companyGoalTitle}` : null,
              objective.dueDate ? `due ${objective.dueDate}` : null
            ]
              .filter(Boolean)
              .join(' · ')}
            leading={<Icons.goal aria-hidden />}
            action={
              <NativeSelect
                aria-label={`Status of ${objective.title}`}
                size='sm'
                value={objective.status}
                disabled={pendingId === objective.id}
                onChange={(e) => setStatus(objective.id, e.target.value)}
              >
                {STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        ))
      )}
      {objectives.length > 0 && (
        <div className='px-4 py-3'>
          <Progress
            value={Math.round(
              objectives.reduce((sum, o) => sum + (o.status === 'achieved' ? 100 : 0), 0) /
                objectives.length
            )}
          />
          <p className='text-muted-foreground mt-1.5 text-xs'>
            {objectives.filter((o) => o.status === 'achieved').length} of {objectives.length}{' '}
            achieved
          </p>
        </div>
      )}
      <CreateObjectiveDialog subjects={subjects} goals={goals} />
    </ListGroup>
  );
}

function CreateObjectiveDialog({
  subjects,
  goals
}: {
  subjects: SubjectOption[];
  goals: { id: string; title: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const self = subjects.find((s) => s.isSelf);
  const [employeeId, setEmployeeId] = React.useState(self?.id ?? subjects[0]?.id ?? '');
  const [title, setTitle] = React.useState('');
  const [goalId, setGoalId] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type='button'
            aria-label='Add an objective'
            className='hover:bg-muted/60 w-full px-4 py-3 text-start'
          />
        }
      >
        <span className='text-primary text-sm font-medium'>+ Add an objective</span>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>New objective</DialogTitle>
          <DialogDescription>Align it to a company goal if it supports one.</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          {subjects.length > 1 && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='obj-subject'>For</Label>
              <NativeSelect
                className='w-full'
                id='obj-subject'
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
          )}
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='obj-title'>Objective</Label>
            <Input id='obj-title' value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='obj-goal'>Company goal</Label>
            <NativeSelect
              className='w-full'
              id='obj-goal'
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value=''>Not aligned to one</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='obj-due'>Due date</Label>
            <Input
              id='obj-due'
              type='date'
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await createObjective({
                    employeeId,
                    title: title.trim(),
                    companyGoalId: goalId || undefined,
                    dueDate: dueDate || undefined
                  });
                  toast.success('Objective added');
                  setOpen(false);
                  setTitle('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OneToOneList({
  oneToOnes,
  subjects
}: {
  oneToOnes: OneToOneRow[];
  subjects: SubjectOption[];
}) {
  const reports = subjects.filter((s) => s.isReport || !s.isSelf);

  return (
    <ListGroup label='One-to-ones'>
      {oneToOnes.length === 0 ? (
        <ListRow
          label='None recorded'
          description='Write-ups of one-to-one conversations appear here.'
          leading={<Icons.review aria-hidden />}
        />
      ) : (
        oneToOnes.map((entry) => (
          <ListRow
            key={entry.id}
            label={`${entry.employeeName} · ${entry.heldOn}`}
            description={entry.sharedNotes ?? entry.agenda ?? 'No notes recorded'}
            leading={<Icons.review aria-hidden />}
            value={
              entry.privateNotes ? <Badge variant='outline'>has private notes</Badge> : undefined
            }
          />
        ))
      )}
      {reports.length > 0 && <RecordOneToOneDialog subjects={reports} />}
    </ListGroup>
  );
}

function RecordOneToOneDialog({ subjects }: { subjects: SubjectOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [employeeId, setEmployeeId] = React.useState(subjects[0]?.id ?? '');
  const [heldOn, setHeldOn] = React.useState(new Date().toISOString().slice(0, 10));
  const [sharedNotes, setSharedNotes] = React.useState('');
  const [privateNotes, setPrivateNotes] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type='button'
            aria-label='Record a one-to-one'
            className='hover:bg-muted/60 w-full px-4 py-3 text-start'
          />
        }
      >
        <span className='text-primary text-sm font-medium'>+ Record a one-to-one</span>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Record a one-to-one</DialogTitle>
          <DialogDescription>
            Shared notes are visible to the employee. Private notes are not.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oto-subject'>With</Label>
            <NativeSelect
              className='w-full'
              id='oto-subject'
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oto-date'>Held on</Label>
            <Input
              id='oto-date'
              type='date'
              value={heldOn}
              onChange={(e) => setHeldOn(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oto-shared'>Shared notes</Label>
            <Textarea
              id='oto-shared'
              rows={3}
              value={sharedNotes}
              onChange={(e) => setSharedNotes(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oto-private'>Private notes</Label>
            <Textarea
              id='oto-private'
              rows={2}
              value={privateNotes}
              onChange={(e) => setPrivateNotes(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Visible to you and to HR. Still disclosable to the employee if they make a subject
              access request.
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!employeeId || !heldOn || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await recordOneToOne({
                    employeeId,
                    heldOn,
                    sharedNotes: sharedNotes.trim() || undefined,
                    privateNotes: privateNotes.trim() || undefined
                  });
                  toast.success('Recorded');
                  setOpen(false);
                  setSharedNotes('');
                  setPrivateNotes('');
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppraisalList({
  appraisals,
  callerId
}: {
  appraisals: AppraisalRow[];
  callerId: string;
}) {
  if (appraisals.length === 0) return null;

  return (
    <ListGroup label='Appraisals'>
      {appraisals.map((appraisal) => (
        <ListRow
          key={appraisal.id}
          label={`${appraisal.employeeName} · ${appraisal.cycle}`}
          description={appraisal.dueDate ? `Due ${appraisal.dueDate}` : undefined}
          leading={<Icons.review aria-hidden />}
          value={
            <span className='flex items-center gap-2'>
              {appraisal.rating !== null && (
                <Badge variant='secondary'>{appraisal.rating} / 5</Badge>
              )}
              <Badge variant='outline'>{appraisal.status.replaceAll('_', ' ')}</Badge>
            </span>
          }
          action={<ReviewButton appraisal={appraisal} callerId={callerId} />}
        />
      ))}
    </ListGroup>
  );
}

function ReviewButton({ appraisal, callerId }: { appraisal: AppraisalRow; callerId: string }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [rating, setRating] = React.useState('3');
  const [pending, startTransition] = React.useTransition();

  const isSubject = appraisal.employeeId === callerId;
  const wantsSelfReview = isSubject && appraisal.status === 'awaiting_self_review';
  const wantsManagerReview = !isSubject && appraisal.status === 'awaiting_manager_review';

  if (!wantsSelfReview && !wantsManagerReview) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm' />}>
        {wantsSelfReview ? 'Write self-review' : 'Write review'}
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{wantsSelfReview ? 'Your self-review' : 'Manager review'}</DialogTitle>
          <DialogDescription>
            {appraisal.employeeName} · {appraisal.cycle}
          </DialogDescription>
        </DialogHeader>
        {wantsManagerReview && appraisal.selfReview && (
          <div className='bg-muted/60 max-h-40 overflow-y-auto rounded-xl p-3 text-sm'>
            <p className='mb-1 text-xs font-medium'>Their self-review</p>
            <p className='whitespace-pre-wrap'>{appraisal.selfReview}</p>
          </div>
        )}
        <div className='flex flex-col gap-3'>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          {wantsManagerReview && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor={`rating-${appraisal.id}`}>Rating</Label>
              <NativeSelect
                className='w-full'
                id={`rating-${appraisal.id}`}
                value={rating}
                onChange={(e) => setRating(e.target.value)}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={String(value)}>
                    {value} / 5
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
          <Button
            disabled={!text.trim() || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  if (wantsSelfReview) {
                    await submitSelfReview({ appraisalId: appraisal.id, text });
                  } else {
                    await submitManagerReview({
                      appraisalId: appraisal.id,
                      text,
                      rating: Number(rating)
                    });
                  }
                  toast.success('Submitted');
                  setOpen(false);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KudosWall({
  entries,
  subjects
}: {
  entries: { id: string; message: string; toName: string; fromName: string | null }[];
  subjects: SubjectOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [toEmployeeId, setToEmployeeId] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const others = subjects.filter((s) => !s.isSelf);

  return (
    <ListGroup label='Recognition' note='Visible to everyone at the organisation.'>
      {entries.length === 0 ? (
        <ListRow
          label='Nothing yet'
          description='Recognition posted here is visible to the whole company.'
          leading={<Icons.kudos aria-hidden />}
        />
      ) : (
        entries.map((entry) => (
          <ListRow
            key={entry.id}
            label={entry.toName}
            description={entry.message}
            leading={<Icons.kudos aria-hidden />}
            value={
              entry.fromName ? (
                <span className='text-muted-foreground text-xs'>from {entry.fromName}</span>
              ) : undefined
            }
          />
        ))
      )}
      {others.length > 0 && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <button
                type='button'
                aria-label='Recognise someone'
                className='hover:bg-muted/60 w-full px-4 py-3 text-start'
              />
            }
          >
            <span className='text-primary text-sm font-medium'>+ Recognise someone</span>
          </DialogTrigger>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>Recognise someone</DialogTitle>
              <DialogDescription>This appears on the company recognition wall.</DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='kudos-to'>Who</Label>
                <NativeSelect
                  className='w-full'
                  id='kudos-to'
                  value={toEmployeeId}
                  onChange={(e) => setToEmployeeId(e.target.value)}
                >
                  <option value=''>Choose someone</option>
                  {others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='kudos-message'>What they did</Label>
                <Textarea
                  id='kudos-message'
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant='ghost' />}>Cancel</DialogClose>
              <Button
                disabled={!toEmployeeId || !message.trim() || pending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await giveKudos({ toEmployeeId, message: message.trim() });
                      toast.success('Posted');
                      setOpen(false);
                      setMessage('');
                      setToEmployeeId('');
                    } catch (error) {
                      toast.error(hrErrorMessage(error));
                    }
                  })
                }
              >
                {pending ? 'Posting…' : 'Post'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </ListGroup>
  );
}

export function SurveyPrompt({
  survey
}: {
  survey: { id: string; title: string; question: string; isAnonymous: boolean };
}) {
  const [score, setScore] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [done, setDone] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  if (done) {
    return (
      <ListGroup label='Survey'>
        <ListRow
          label='Thank you'
          description='Your response has been recorded.'
          leading={<Icons.check aria-hidden />}
        />
      </ListGroup>
    );
  }

  return (
    <ListGroup
      label={survey.title}
      note={
        survey.isAnonymous
          ? 'Anonymous. Your identity is not recorded against your answer at all — not stored and hidden, simply never written.'
          : 'Your name is recorded with this response.'
      }
    >
      <div className='flex flex-col gap-3 px-4 py-3'>
        <p className='text-sm'>{survey.question}</p>
        <div className='flex flex-wrap gap-1'>
          {Array.from({ length: 11 }, (_, value) => (
            <Button
              key={value}
              size='sm'
              variant={score === String(value) ? 'default' : 'outline'}
              onClick={() => setScore(String(value))}
            >
              {value}
            </Button>
          ))}
        </div>
        <Textarea
          rows={2}
          placeholder='Anything you want to add (optional)'
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div>
          <Button
            disabled={score === '' || pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await respondToSurvey({
                    surveyId: survey.id,
                    score: Number(score),
                    comment: comment.trim() || undefined
                  });
                  setDone(true);
                } catch (error) {
                  toast.error(hrErrorMessage(error));
                }
              })
            }
          >
            {pending ? 'Sending…' : 'Send response'}
          </Button>
        </div>
      </div>
    </ListGroup>
  );
}
