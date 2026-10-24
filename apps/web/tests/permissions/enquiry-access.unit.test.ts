import { describe, expect, it } from 'vitest';
import { canCreateEnquiry, canEditEnquiry, canViewEnquiry } from '@/lib/permissions/enquiry-access';
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

describe('canViewEnquiry', () => {
  it("allows an EMPLOYEE to view an enquiry on their own team (no assignee concept to be 'own' via)", () => {
    const caller = employee({ role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewEnquiry(caller, { id: 'q1', team: 'alpha' })).toBe(true);
  });

  it("rejects an EMPLOYEE viewing a different team's enquiry", () => {
    const caller = employee({ role: 'EMPLOYEE', team: 'alpha' });
    expect(canViewEnquiry(caller, { id: 'q1', team: 'beta' })).toBe(false);
  });

  it('rejects a SECURITY_ADMIN viewing any enquiry (scoped away from business data)', () => {
    const caller = employee({ role: 'SECURITY_ADMIN', team: null });
    expect(canViewEnquiry(caller, { id: 'q1', team: 'alpha' })).toBe(false);
  });

  it('allows a TEAM_LEAD to view a same-team enquiry, rejects a different-team one', () => {
    const caller = employee({ role: 'TEAM_LEAD', team: 'alpha' });
    expect(canViewEnquiry(caller, { id: 'q1', team: 'alpha' })).toBe(true);
    expect(canViewEnquiry(caller, { id: 'q1', team: 'beta' })).toBe(false);
  });

  it("allows a MANAGER to view any team's enquiry (cross-team scope)", () => {
    const caller = employee({ role: 'MANAGER', team: 'alpha' });
    expect(canViewEnquiry(caller, { id: 'q1', team: 'zzz-other' })).toBe(true);
  });

  it('allows an ADMIN to view any enquiry', () => {
    const caller = employee({ role: 'ADMIN', team: null });
    expect(canViewEnquiry(caller, { id: 'q1', team: 'beta' })).toBe(true);
  });
});

describe('canEditEnquiry', () => {
  it("matches canViewEnquiry's scoping", () => {
    const caller = employee({ role: 'TEAM_LEAD', team: 'alpha' });
    expect(canEditEnquiry(caller, { id: 'q1', team: 'alpha' })).toBe(true);
    expect(canEditEnquiry(caller, { id: 'q1', team: 'beta' })).toBe(false);
  });
});

describe('canCreateEnquiry', () => {
  it('allows any role with business-data scope, rejects SECURITY_ADMIN', () => {
    expect(canCreateEnquiry(employee({ role: 'EMPLOYEE' }))).toBe(true);
    expect(canCreateEnquiry(employee({ role: 'ADMIN' }))).toBe(true);
    expect(canCreateEnquiry(employee({ role: 'SECURITY_ADMIN', team: null }))).toBe(false);
  });
});
