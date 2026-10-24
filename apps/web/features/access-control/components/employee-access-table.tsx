'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  approveEmployee,
  disableEmployee,
  rejectEmployee,
  updateEmployeeCapabilities,
  updateEmployeeRoleTeam
} from '@/features/access-control/actions';
import { ROLES, type Role } from '@/lib/permissions/roles';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export type EmployeeRowData = {
  id: string;
  /** What the Hub calls this person — the name they set in Settings. */
  name: string;
  /** The name on their sign-in account. Shown only when it differs from the above. */
  accountName: string;
  email: string;
  role: Role | null;
  team: string | null;
  status: 'pending' | 'active' | 'disabled' | 'rejected';
  hrAdmin: boolean;
  financeAccess: boolean;
  /**
   * Where this account was last seen, already rendered for display by the page.
   *
   * Formatted server-side rather than passed raw: the device description is derived from a user
   * agent string, and that parsing belongs next to the recorder that stores it rather than in a
   * second copy here that can drift. Null until the account has signed in at least once.
   */
  lastSignIn: { when: string; where: string } | null;
};

/**
 * What each role actually means, in the words someone granting it would use.
 *
 * The dropdown used to list bare constant names — EMPLOYEE, TEAM_LEAD, MANAGER — which tells an
 * administrator the spelling and nothing about the consequence. These sentences are the same
 * rules as docs/permissions-matrix.md and lib/permissions/roles.ts; change them together.
 */
const ROLE_DESCRIPTIONS: Record<Role, string> = {
  EMPLOYEE: 'Their own work only — tasks assigned to them and clients they are staffed on.',
  TEAM_LEAD: 'Everything their team can see, and can assign work within it.',
  MANAGER: 'Clients, projects and tasks across every team, plus the standard reports.',
  ADMIN: 'Runs the platform: people, roles, integrations and automations. Not HR records.',
  SECURITY_ADMIN: 'Sessions, audit log and security events only. No business or HR data.',
  HR_ADMIN: 'The whole HR module, including pay and medical detail. No business data.'
};

function statusVariant(status: EmployeeRowData['status']) {
  if (status === 'active') return 'default';
  if (status === 'pending') return 'secondary';
  return 'destructive';
}

const STATUS_LABELS: Record<EmployeeRowData['status'], string> = {
  pending: 'waiting',
  active: 'active',
  disabled: 'switched off',
  rejected: 'refused'
};

/** The device and address a request came from, for the administrator deciding whether to let it in. */
function SignInOrigin({ lastSignIn }: { lastSignIn: EmployeeRowData['lastSignIn'] }) {
  if (!lastSignIn) {
    return (
      <p className='text-muted-foreground text-xs'>
        No sign-in recorded yet for this account.
      </p>
    );
  }

  return (
    <p className='text-muted-foreground text-xs'>
      Last seen {lastSignIn.when} — {lastSignIn.where}
    </p>
  );
}

function CapabilitySwitch({
  id,
  checked,
  disabled,
  onChange,
  label,
  hint
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className='flex items-start gap-2.5'>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div className='min-w-0'>
        <Label htmlFor={id} className='text-sm font-normal'>
          {label}
        </Label>
        <p className='text-muted-foreground text-xs'>{hint}</p>
      </div>
    </div>
  );
}

function EmployeeCard({
  employee,
  currentEmployeeId
}: {
  employee: EmployeeRowData;
  currentEmployeeId: string;
}) {
  const [role, setRole] = useState<Role>(employee.role ?? 'EMPLOYEE');
  const [team, setTeam] = useState(employee.team ?? '');
  const [hrAdmin, setHrAdmin] = useState(employee.hrAdmin);
  const [financeAccess, setFinanceAccess] = useState(employee.financeAccess);
  const [isPending, startTransition] = useTransition();

  const isSelf = employee.id === currentEmployeeId;
  const isDisabled = employee.status === 'disabled';
  const isRefused = employee.status === 'rejected';

  function handleApprove() {
    startTransition(async () => {
      try {
        await (approveEmployee(employee.id, role, team));
        toast.success(`${employee.name} approved as ${role}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to approve employee');
      }
    });
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await (updateEmployeeRoleTeam(employee.id, role, team));
        toast.success(`${employee.name}: role and team saved`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update employee');
      }
    });
  }

  // Capabilities save on toggle rather than waiting for the Save button, because they are not
  // part of the role/team form — leaving them staged there would make one Save button write
  // four unrelated things and make it unclear which of them the confirmation referred to.
  function handleCapability(next: { hrAdmin: boolean; financeAccess: boolean }) {
    const previous = { hrAdmin, financeAccess };
    setHrAdmin(next.hrAdmin);
    setFinanceAccess(next.financeAccess);

    startTransition(async () => {
      try {
        await (updateEmployeeCapabilities(employee.id, next));
        toast.success(`${employee.name}: access updated`);
      } catch (err) {
        // Put the switch back where it was — a control that stays flipped after a failed save
        // is a lie about what the server holds.
        setHrAdmin(previous.hrAdmin);
        setFinanceAccess(previous.financeAccess);
        toast.error(err instanceof Error ? err.message : 'Failed to update access');
      }
    });
  }

  function handleDisable() {
    startTransition(async () => {
      try {
        await (disableEmployee(employee.id));
        toast.success(`${employee.name} disabled`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to disable employee');
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      try {
        await (rejectEmployee(employee.id));
        toast.success(`${employee.name} was refused access`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to refuse access');
      }
    });
  }

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-2xl p-4 ring-1'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>
            {employee.name}
            {isSelf && <span className='text-muted-foreground font-normal'> — you</span>}
          </p>
          <p className='text-muted-foreground truncate text-xs'>{employee.email}</p>
          {employee.accountName !== employee.name && (
            <p className='text-muted-foreground truncate text-xs'>
              Sign-in account name: {employee.accountName}
            </p>
          )}
          <SignInOrigin lastSignIn={employee.lastSignIn} />
        </div>
        <Badge variant={statusVariant(employee.status)}>{STATUS_LABELS[employee.status]}</Badge>
      </div>

      {isDisabled || isRefused ? (
        <>
          <p className='text-muted-foreground text-sm'>
            {isRefused
              ? 'This request was refused and their sign-in account is banned. Granting a role below lets them in and lifts the ban.'
              : 'Access is switched off and their sign-in account is banned. Role and access were cleared at the same time, so letting them back in means granting them again deliberately.'}
          </p>

          {/* Both states are recoverable, and before this neither was: the ban stayed on the
              account however the row was edited. The control that reverses them is the same
              approval control used for a new request, so there is one way into 'active'. */}
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor={`role-${employee.id}`}>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={isPending}>
                <SelectTrigger id={`role-${employee.id}`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>{ROLE_DESCRIPTIONS[role]}</p>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor={`team-${employee.id}`}>Team</Label>
              <Input
                id={`team-${employee.id}`}
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder='e.g. immigration'
                disabled={isPending}
              />
            </div>
          </div>

          <div>
            <Button size='sm' onClick={handleApprove} disabled={isPending}>
              Let them in with this role
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor={`role-${employee.id}`}>Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                disabled={isPending}
              >
                <SelectTrigger id={`role-${employee.id}`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>{ROLE_DESCRIPTIONS[role]}</p>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor={`team-${employee.id}`}>Team</Label>
              <Input
                id={`team-${employee.id}`}
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder='e.g. immigration'
                disabled={isPending}
              />
              <p className='text-muted-foreground text-xs'>
                Free text, and it decides what a TEAM_LEAD can see. Leave blank if they are not on
                a team yet.
              </p>
            </div>
          </div>

          {employee.status === 'active' && (
            <div className='border-t pt-3'>
              <p className='mb-2 text-sm font-medium'>Extra access</p>
              <div className='grid gap-3 sm:grid-cols-2'>
                <CapabilitySwitch
                  id={`hr-${employee.id}`}
                  checked={hrAdmin}
                  disabled={isPending || role === 'SECURITY_ADMIN'}
                  onChange={(next) => handleCapability({ hrAdmin: next, financeAccess })}
                  label='HR administration'
                  hint='Configure leave, absence and documents, and see every employee record. Grant this to yourself if you run HR as well as the platform.'
                />
                <CapabilitySwitch
                  id={`finance-${employee.id}`}
                  checked={financeAccess}
                  disabled={isPending || role === 'SECURITY_ADMIN'}
                  onChange={(next) => handleCapability({ hrAdmin, financeAccess: next })}
                  label='Finance access'
                  hint='Pay figures and expense amounts across the company. Does not include identity or medical detail.'
                />
              </div>
              {role === 'SECURITY_ADMIN' && (
                <p className='text-muted-foreground mt-2 text-xs'>
                  A security administrator is walled off from business and HR data, so neither of
                  these can be granted alongside that role.
                </p>
              )}
            </div>
          )}

          <div className='flex flex-wrap items-center gap-2'>
            {employee.status === 'pending' ? (
              <>
                <Button size='sm' onClick={handleApprove} disabled={isPending}>
                  Approve with this role
                </Button>
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={handleReject}
                  disabled={isPending}
                >
                  Refuse access
                </Button>
              </>
            ) : (
              <>
                <Button size='sm' variant='outline' onClick={handleSave} disabled={isPending}>
                  Save role and team
                </Button>
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={handleDisable}
                  disabled={isPending || isSelf}
                  title={isSelf ? 'You cannot switch off your own access' : undefined}
                >
                  Switch off access
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function EmployeeAccessTable({
  employees,
  currentEmployeeId
}: {
  employees: EmployeeRowData[];
  currentEmployeeId: string;
}) {
  // Pending sign-ups first: they are the only rows that need an action taken rather than
  // reviewed, and burying them under everyone else is how an approval sits for a week.
  const pending = employees.filter((e) => e.status === 'pending');
  const rest = employees.filter((e) => e.status !== 'pending');

  if (employees.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        Nobody has signed up yet. Anyone who signs in with a email address appears here as a
        pending request for you to approve.
      </p>
    );
  }

  return (
    <div className='flex flex-col gap-5'>
      {pending.length > 0 && (
        <section className='flex flex-col gap-3'>
          <div>
            <h3 className='text-sm font-medium'>
              Waiting for you ({pending.length})
            </h3>
            <p className='text-muted-foreground text-xs'>
              These people have signed in but cannot reach anything until you give them a role.
            </p>
          </div>
          {pending.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              currentEmployeeId={currentEmployeeId}
            />
          ))}
        </section>
      )}

      <section className='flex flex-col gap-3'>
        {pending.length > 0 && <h3 className='text-sm font-medium'>Everyone else</h3>}
        {rest.map((employee) => (
          <EmployeeCard
            key={employee.id}
            employee={employee}
            currentEmployeeId={currentEmployeeId}
          />
        ))}
      </section>
    </div>
  );
}
