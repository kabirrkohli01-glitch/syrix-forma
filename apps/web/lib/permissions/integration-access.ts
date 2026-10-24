import { canManageIntegrations as roleCanManageIntegrations } from './roles';
import type { ActiveEmployee } from './current-employee';

// Integrations are platform-level configuration, same tier as Automations — viewing and
// managing are both ADMIN-only (docs/permissions-matrix.md), with no team/cross-team split.
export function canViewIntegrations(caller: ActiveEmployee): boolean {
  return roleCanManageIntegrations(caller.role);
}

export function canManageIntegrations(caller: ActiveEmployee): boolean {
  return roleCanManageIntegrations(caller.role);
}
