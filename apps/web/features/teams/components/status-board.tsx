import { format } from 'date-fns';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { WORK_STATUS_LABEL, WORK_STATUS_TONE } from '@/lib/status-colors';

export type StatusBoardMember = {
  id: string;
  name: string;
  role?: string | null;
  team: string | null;
  workStatus: 'working' | 'on_break' | 'logged_off';
  workStatusChangedAt: Date | null;
  // Real data, not a fabricated percentage: the employee's first active project via
  // project_staff, and their current count of open (not done, not archived) tasks.
  // Optional — callers that only need the plain roster (e.g. the Home dashboard's
  // compact "Team today" card) aren't required to run the extra queries for these.
  currentWork?: string | null;
  openTaskCount?: number;
};

/** First letter of the first two words — "Kabir Kohli" -> "KK", "Kabir" -> "KA". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  TEAM_LEAD: 'Team Lead',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
  SECURITY_ADMIN: 'Security Admin',
  HR_ADMIN: 'HR Admin'
};

// Company-wide by design (docs/permissions-matrix.md's Team Status entry) — unlike every other
// section of this page, this list is never filtered to the caller's own team, so every active
// employee reachable by anyone who can open the Teams page shows up here regardless of role scope.
// Grouped by the raw `team` value present on these members (not the page's scope-filtered team
// list) so that guarantee holds regardless of how the grouping is presented.
export function StatusBoard({ members }: { members: StatusBoardMember[] }) {
  const groupNames = [...new Set(members.map((m) => m.team ?? '__none__'))].toSorted((a, b) =>
    a === '__none__' ? 1 : b === '__none__' ? -1 : a.localeCompare(b)
  );
  const maxOpen = Math.max(1, ...members.map((m) => m.openTaskCount ?? 0));

  return (
    <div className='flex flex-col gap-6'>
      {groupNames.map((groupName) => {
        const groupMembers = members
          .filter((m) => (m.team ?? '__none__') === groupName)
          .toSorted((a, b) => a.name.localeCompare(b.name));

        return (
          <div key={groupName} className='flex flex-col gap-2'>
            <h4 className='text-sm font-semibold capitalize'>
              {groupName === '__none__' ? 'No team assigned' : groupName}
            </h4>
            <div className='overflow-hidden rounded-lg border'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='bg-muted/50 text-muted-foreground border-b text-left text-xs font-medium tracking-wider uppercase'>
                    <th className='px-4 py-2.5'>Person</th>
                    <th className='px-4 py-2.5'>Current work</th>
                    <th className='px-4 py-2.5'>Status</th>
                    <th className='px-4 py-2.5'>Workload</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {groupMembers.map((member) => (
                    <tr key={member.id}>
                      <td className='px-4 py-2.5' aria-label={`${member.name}, ${member.role ? (ROLE_LABEL[member.role] ?? member.role) : 'no role set'}`}>
                        <div className='flex items-center gap-2.5'>
                          <Avatar className='size-7'>
                            <AvatarFallback className='text-xs'>{initialsOf(member.name)}</AvatarFallback>
                          </Avatar>
                          <div className='min-w-0'>
                            <p className='truncate font-medium'>{member.name}</p>
                            {member.role && (
                              <p className='text-muted-foreground text-xs'>
                                {ROLE_LABEL[member.role] ?? member.role}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className='text-muted-foreground px-4 py-2.5'>{member.currentWork ?? '—'}</td>
                      <td className='px-4 py-2.5'>
                        <div className='flex flex-col gap-0.5'>
                          <StatusBadge tone={WORK_STATUS_TONE[member.workStatus]}>
                            {WORK_STATUS_LABEL[member.workStatus]}
                          </StatusBadge>
                          {member.workStatusChangedAt && (
                            <span className='text-muted-foreground text-[11px]'>
                              since {format(member.workStatusChangedAt, 'p')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className='px-4 py-2.5' aria-label={`${member.openTaskCount ?? 0} open tasks`}>
                        <div className='flex items-center gap-2'>
                          <div className='bg-muted h-1.5 w-24 overflow-hidden rounded-full'>
                            <div
                              className='bg-primary h-full rounded-full'
                              style={{ width: `${Math.min(100, ((member.openTaskCount ?? 0) / maxOpen) * 100)}%` }}
                            />
                          </div>
                          <span className='text-muted-foreground text-xs whitespace-nowrap'>
                            {member.openTaskCount ?? 0} open
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
