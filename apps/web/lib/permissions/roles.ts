// Mirrors docs/permissions-matrix.md and engineering rule 10. Change both in the same commit.

export const ROLES = [
  'EMPLOYEE',
  'TEAM_LEAD',
  'MANAGER',
  'ADMIN',
  'SECURITY_ADMIN',
  'HR_ADMIN'
] as const;
export type Role = (typeof ROLES)[number];

export type ResourceScope = 'own' | 'team' | 'cross-team' | 'all' | 'none';

const CLIENT_PROJECT_TASK_SCOPE: Record<Role, ResourceScope> = {
  EMPLOYEE: 'own',
  TEAM_LEAD: 'team',
  MANAGER: 'cross-team',
  ADMIN: 'all',
  SECURITY_ADMIN: 'none',
  // HR_ADMIN is 'own' rather than 'none': unlike SECURITY_ADMIN, which is a pure oversight
  // role, an HR administrator is a working employee who has their own tasks, clients and
  // calendar. Their elevated access is to HR records only, and that is decided entirely in
  // hr-access.ts — nothing here should widen their view of business data.
  HR_ADMIN: 'own'
};

export function scopeForBusinessData(role: Role): ResourceScope {
  return CLIENT_PROJECT_TASK_SCOPE[role];
}

export function canManageUsers(role: Role): boolean {
  return role === 'ADMIN';
}

export function canManageIntegrations(role: Role): boolean {
  return role === 'ADMIN';
}

export function canUseAutomationKillSwitch(role: Role): boolean {
  return role === 'ADMIN';
}

export function canManageAutomations(role: Role): boolean {
  return role === 'ADMIN';
}

export function canViewBasicReports(role: Role): boolean {
  return role === 'MANAGER' || role === 'ADMIN';
}

export function canViewSecurityCentre(role: Role): boolean {
  return role === 'SECURITY_ADMIN';
}

export function canAssignWithinTeam(role: Role): boolean {
  return role === 'TEAM_LEAD' || role === 'MANAGER' || role === 'ADMIN';
}
