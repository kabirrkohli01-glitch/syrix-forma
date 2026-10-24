import { describe, expect, it } from 'vitest';
import { canManageIntegrations, canViewIntegrations } from '@/lib/permissions/integration-access';
import type { ActiveEmployee } from '@/lib/permissions/current-employee';

function employee(overrides: Partial<ActiveEmployee>): ActiveEmployee {
  return {
    id: 'self',
    clerkUserId: 'clerk_self',
    name: 'Test',
    displayName: 'Test',
    email: 'test@example.test',
    role: 'EMPLOYEE',
    team: 'alpha',
    managerId: null,
    financeAccess: false,
    hrAdmin: false,
    ...overrides
  };
}

describe('integration permissions', () => {
  it('only ADMIN can view or manage integrations', () => {
    for (const role of ['EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'SECURITY_ADMIN'] as const) {
      const caller = employee({ role, team: role === 'SECURITY_ADMIN' ? null : 'alpha' });
      expect(canViewIntegrations(caller)).toBe(false);
      expect(canManageIntegrations(caller)).toBe(false);
    }
    const admin = employee({ role: 'ADMIN', team: null });
    expect(canViewIntegrations(admin)).toBe(true);
    expect(canManageIntegrations(admin)).toBe(true);
  });
});
