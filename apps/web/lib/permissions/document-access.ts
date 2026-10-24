import type { ActiveEmployee } from './current-employee';
import { scopeForBusinessData } from './roles';

/**
 * Who can see and manage a document the Hub holds.
 *
 * A document either belongs to a client, a project or a task, or it belongs to a team. Where it
 * has a parent, the parent's own predicate decides — a document attached to a client must never
 * be reachable by someone who cannot open that client, which would make attaching a file a way
 * to widen access to its contents. Only the unattached case needs a rule of its own, and that
 * rule is team, the same one clients and projects already use.
 *
 * Deletion is deliberately narrower than editing. Anyone who can see a team's documents can add
 * to them; removing one that other people's records point at is a team lead's call.
 */
export type DocumentTarget = {
  team: string;
  uploadedByEmployeeId: string;
};

export function canViewTeamDocument(caller: ActiveEmployee, target: DocumentTarget): boolean {
  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all' || scope === 'cross-team') return true;
  if (scope === 'none') return false;
  // 'own' and 'team' alike: an unattached document is team property, and someone with no team is
  // left with the documents they uploaded themselves rather than with none at all.
  if (caller.team !== null && caller.team === target.team) return true;
  return caller.id === target.uploadedByEmployeeId;
}

/** Uploading into a team. The same question as viewing it — there is no read-only tier here. */
export function canAddTeamDocument(caller: ActiveEmployee, team: string): boolean {
  return canViewTeamDocument(caller, { team, uploadedByEmployeeId: caller.id });
}

/**
 * Withdrawing a document. Its uploader may always withdraw their own; otherwise it takes a team
 * lead or above, because a document is frequently the evidence behind a client record and
 * removing one is not the same kind of act as adding one.
 */
export function canArchiveDocument(caller: ActiveEmployee, target: DocumentTarget): boolean {
  if (!canViewTeamDocument(caller, target)) return false;
  if (caller.id === target.uploadedByEmployeeId) return true;
  return caller.role === 'ADMIN' || caller.role === 'MANAGER' || caller.role === 'TEAM_LEAD';
}
