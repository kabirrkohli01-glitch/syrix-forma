import { canManageAutomations as roleCanManageAutomations, canUseAutomationKillSwitch } from './roles';
import type { ActiveEmployee } from './current-employee';

// Automations (definitions + run history) are platform-level configuration, not team-scoped
// business data — there is no team/cross-team tier here the way there is for
// Task/Client/Project/Enquiry. Both viewing and managing are ADMIN-only, same as the master
// kill-switch (docs/permissions-matrix.md).
export function canViewAutomations(caller: ActiveEmployee): boolean {
  return roleCanManageAutomations(caller.role);
}

export function canManageAutomations(caller: ActiveEmployee): boolean {
  return roleCanManageAutomations(caller.role);
}

export function canUseKillSwitch(caller: ActiveEmployee): boolean {
  return canUseAutomationKillSwitch(caller.role);
}
