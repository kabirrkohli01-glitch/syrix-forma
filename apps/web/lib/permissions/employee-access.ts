import { scopeForBusinessData } from './roles';
import type { ActiveEmployee } from './current-employee';

export type EmployeeTarget = { id: string; team: string | null };

// Whether `caller` may view `target`'s employee record. Everyone can view their own; beyond
// that this follows the same scope rules as docs/permissions-matrix.md's business-data rows —
// an employee directory record is treated the same way (own/team/cross-team/all/none).
export function canViewEmployeeRecord(caller: ActiveEmployee, target: EmployeeTarget): boolean {
  if (caller.id === target.id) return true;

  const scope = scopeForBusinessData(caller.role);
  if (scope === 'all') return true;
  if (scope === 'none' || scope === 'own') return false;

  // 'team' (TEAM_LEAD) or 'cross-team' (MANAGER)
  if (caller.role === 'MANAGER') return true;
  return caller.team !== null && caller.team === target.team;
}
