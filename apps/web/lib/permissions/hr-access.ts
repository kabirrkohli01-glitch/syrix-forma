import type { ActiveEmployee } from './current-employee';

/**
 * HR access rules. Deliberately does not use `scopeForBusinessData` anywhere.
 *
 * Every other resource in this app scopes on the caller's team: a TEAM_LEAD sees their team's
 * tasks, a MANAGER sees every team's. Applying that shape to HR would mean a team lead could
 * read a colleague's date of birth, salary and sickness detail purely by being on the same
 * team, which is not a defensible rule for special category personal data. HR therefore scopes
 * on two things that have nothing to do with `team`:
 *
 *   - the line management chain (`employees.managerId`), and
 *   - HR administration (`isHrAdmin`) plus the `financeAccess` flag.
 *
 * ADMIN is intentionally absent from every predicate below. Platform administration — managing
 * users, integrations, the automation kill switch — does not imply standing access to everyone's
 * medical and pay records, for the same reason ADMIN does not get SECURITY_ADMIN's audit log.
 * An ADMIN who needs HR access is granted it explicitly, as a capability on their own record,
 * and that grant is step-up authenticated and audited like any other permission change.
 *
 * Sensitivity runs in three bands, and they are separate predicates rather than one flag
 * because a line manager needs the middle band and must not get the top one:
 *
 *   employment    job title, start date, contract type, working pattern
 *                 -> self, line manager, HR_ADMIN
 *   identity      date of birth, NI number, home address, emergency contact
 *                 -> self, HR_ADMIN
 *   pay           salary, hourly rate, bank details
 *                 -> self, HR_ADMIN, finance users
 *
 * See docs/permissions-matrix.md and docs/data-classification.md.
 */

/** The subject of an HR permission check. `managerId` is the target's own line manager. */
export type HrEmployeeTarget = { id: string; managerId: string | null };

/**
 * Whether the caller administers HR.
 *
 * There are two ways to hold it and they mean the same thing here: the dedicated HR_ADMIN role,
 * or the `hrAdmin` capability granted on top of whatever role someone already has. The capability
 * exists because an employee holds exactly one role, which made HR administration mutually
 * exclusive with platform administration — see the column comment in schema.ts.
 *
 * Every predicate below goes through this function rather than comparing the role directly, so
 * one place decides what "is HR" means and no screen can end up asking a slightly different
 * question than the action behind it.
 */
export function isHrAdmin(caller: ActiveEmployee): boolean {
  // hrScopeFor() already returns 'none' for SECURITY_ADMIN before anything reaches here, but
  // assert it again: the capability must never become a route around that wall, whoever sets it.
  if (caller.role === 'SECURITY_ADMIN') return false;
  return caller.role === 'HR_ADMIN' || caller.hrAdmin;
}

export type HrScope =
  /** Sees nothing, not even their own record — SECURITY_ADMIN. */
  | 'none'
  /** Sees only their own record. */
  | 'self'
  /** Own record, plus the employment band for direct reports. */
  | 'reports'
  /** Every band for every employee — HR_ADMIN. */
  | 'all';

export function hrScopeFor(caller: ActiveEmployee): HrScope {
  // SECURITY_ADMIN is walled off from business data everywhere else in this app; HR data is
  // more sensitive than that, not less, so the same wall applies. It is not an exception for
  // their own record either — a SECURITY_ADMIN who is also an employee of the organisation would hold that
  // record under a normal account, not under the security role.
  if (caller.role === 'SECURITY_ADMIN') return 'none';
  if (isHrAdmin(caller)) return 'all';
  // Every other role's breadth depends on whether anyone reports to them, which is a database
  // fact rather than a property of the role — so 'reports' is the honest answer for all of
  // them, and the per-target predicates below decide whether a given person is actually a
  // report. A caller with no reports simply never satisfies that branch.
  return 'reports';
}

export function isSelf(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return caller.id === target.id;
}

export function isLineManagerOf(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  // A null managerId means the target has no line manager set. It must never match a caller
  // whose own id is somehow null-ish, so compare explicitly rather than relying on equality.
  return target.managerId !== null && target.managerId === caller.id;
}

/**
 * Employment band: job title, contract type, start date, working pattern, training records.
 * What a line manager needs to do their job.
 */
export function canViewEmployeeRecord(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  const scope = hrScopeFor(caller);
  if (scope === 'none') return false;
  if (scope === 'all') return true;
  return isSelf(caller, target) || isLineManagerOf(caller, target);
}

/**
 * Identity band: date of birth, National Insurance number, home address, emergency contact.
 * A line manager has no business need for any of it, so they do not get it — this is the
 * predicate that must not collapse into canViewEmployeeRecord.
 */
export function canViewEmployeeIdentity(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  const scope = hrScopeFor(caller);
  if (scope === 'none') return false;
  if (scope === 'all') return true;
  return isSelf(caller, target);
}

/**
 * Pay band: salary, hourly rate, bank details.
 *
 * `financeAccess` is a per-employee flag rather than a role so it can compose with whatever
 * role the holder already has (see schema.ts's comment on the column). It grants pay figures
 * across the company and nothing else — a finance user still cannot read the identity band.
 */
export function canViewEmployeePay(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  const scope = hrScopeFor(caller);
  if (scope === 'none') return false;
  if (scope === 'all') return true;
  if (caller.financeAccess) return true;
  return isSelf(caller, target);
}

/**
 * Whether the caller may see a company-wide list of people.
 *
 * Separate from `hrScopeFor` because breadth of the *list* and depth of each *record* are two
 * different questions. A finance user is entitled to pay across the company, so a list limited
 * to themselves and their reports would leave them no way to reach it — but widening
 * `hrScopeFor` to 'all' for them would wrongly hand them the identity band too, since the band
 * predicates key off that scope. Keeping them apart is what lets a finance user find everyone
 * and still read only pay.
 */
export function canListAllEmployees(caller: ActiveEmployee): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isHrAdmin(caller) || caller.financeAccess;
}

/**
 * Whether the caller may open this person's record at all, in any form.
 *
 * Deliberately the union of the bands rather than the employment band alone. A finance user is
 * entitled to pay across the company but to no employment detail, so gating the record fetch on
 * `canViewEmployeeRecord` would hand them an empty result for everyone and make their own
 * permission unusable. Callers still have to check each band separately before reading it —
 * this only answers "is there anything here for you", which is also what decides 404 vs. a
 * rendered page.
 */
export function canOpenEmployeeRecord(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return (
    canViewEmployeeRecord(caller, target) ||
    canViewEmployeeIdentity(caller, target) ||
    canViewEmployeePay(caller, target)
  );
}

/**
 * Writing is narrower than reading throughout: an employee can read their own pay record but
 * must not be able to edit it, and a finance user can read salaries without being able to set
 * one. Only HR_ADMIN writes HR records.
 */
export function canEditEmployeeRecord(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

export function canEditEmployeePay(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/**
 * The subset of their own record an employee may change without HR. Deliberately excludes
 * anything that decides pay, entitlement or identity — job title, contract type, start date,
 * salary and National Insurance number are all HR-set. Someone moving house should not have to
 * raise a ticket; someone giving themselves a new job title should.
 */
export function canEditOwnProfileContactDetails(
  caller: ActiveEmployee,
  target: HrEmployeeTarget
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target) || isHrAdmin(caller);
}

/**
 * Company-level HR configuration: custom field definitions, leave types and policy, absence
 * trigger thresholds, document templates.
 */
export function canManageHrSettings(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/** Aggregate HR reporting — headcount, turnover, absence rates. Contains no one person's record. */
export function canViewHrReports(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/**
 * Payroll export. Stricter than either reporting or pay viewing on its own: it produces a file
 * containing every employee's pay detail at once, which is a different risk from looking up one
 * person's salary on screen. Gated to HR_ADMIN and finance users, and the calling action layers
 * step-up auth and an audit entry on top (docs/permissions-matrix.md).
 */
export function canExportPayroll(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller) || caller.financeAccess;
}

// --- Time off and absence ---

/**
 * Seeing someone's leave. Follows the employment band: a line manager needs to know when their
 * report is away in order to plan the work.
 */
export function canViewLeaveRequest(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

export function canRequestLeaveFor(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  // HR can book leave on someone's behalf — people phone in. A line manager cannot: booking
  // leave in someone else's name is a different act from approving leave they asked for.
  return isSelf(caller, target) || isHrAdmin(caller);
}

/**
 * Deciding a leave request.
 *
 * The self-exclusion is the point of this predicate. Without it a MANAGER whose own `managerId`
 * is null — which is the normal state for the most senior person in a chain — would fall
 * through to some broader rule and approve their own holiday. Approval is always someone
 * else's act, and HR is the backstop when nobody is named as line manager.
 */
export function canDecideLeaveRequest(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isSelf(caller, target)) return false;
  return isHrAdmin(caller) || isLineManagerOf(caller, target);
}

/**
 * Cancelling. An employee may withdraw their own request; HR may cancel anyone's. A line
 * manager declines rather than cancels — declining is a decision on a request that was made,
 * cancelling is the requester changing their mind, and conflating them loses that distinction
 * in the record.
 */
export function canCancelLeaveRequest(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target) || isHrAdmin(caller);
}

/**
 * Absence *dates* — that someone was off sick, when, and for how long. A line manager needs
 * this to manage the work, exactly as they need leave dates.
 */
export function canViewAbsenceRecord(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

/**
 * Absence *medical detail* — the category, the notes, the fit note.
 *
 * This is health data: special category under UK GDPR Article 9, and the single most sensitive
 * thing in the HR module. A line manager gets the dates and not the reason. Kept as its own
 * predicate rather than reusing `canViewEmployeeIdentity` because the two bands can diverge —
 * an occupational-health arrangement might widen one without the other — and because the name
 * of the check should say what it protects.
 */
export function canViewAbsenceMedicalDetail(
  caller: ActiveEmployee,
  target: HrEmployeeTarget
): boolean {
  const scope = hrScopeFor(caller);
  if (scope === 'none') return false;
  if (scope === 'all') return true;
  return isSelf(caller, target);
}

/** Recording an absence. A manager logging that their report phoned in sick is routine. */
export function canRecordAbsence(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target) || isLineManagerOf(caller, target) || isHrAdmin(caller);
}

/**
 * Conducting a return-to-work interview. Deliberately excludes the returning employee: an
 * interview someone records about themselves is not a return-to-work interview.
 */
export function canRecordReturnToWork(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isSelf(caller, target)) return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller);
}

/**
 * Absence trigger flags (Bradford score breaches). Shown to whoever would act on them — the
 * line manager and HR — and never to the wider company.
 */
export function canViewAbsenceTriggers(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isHrAdmin(caller) || isLineManagerOf(caller, target);
}

// --- Documents ---

/**
 * A company-wide document (handbook, policy) is readable by every active employee — that is
 * what makes it a company document. A personal one follows the employment band.
 */
export function canViewHrDocument(
  caller: ActiveEmployee,
  document: { visibility: 'company' | 'employee'; employeeId: string | null }
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (document.visibility === 'company') return true;
  if (!document.employeeId) return false;
  // A line manager does not get their report's personal documents, which is why this
  // predicate takes no manager id at all: a contract or a disciplinary letter is not
  // something the employment band covers, even though a job title is. The document set is
  // where the genuinely sensitive material lives, so it follows the identity band instead.
  return caller.id === document.employeeId || isHrAdmin(caller);
}

export function canManageHrDocuments(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/** Only the named audience acknowledges; nobody acknowledges on someone else's behalf. */
export function canAcknowledgeHrDocument(
  caller: ActiveEmployee,
  document: { visibility: 'company' | 'employee'; employeeId: string | null }
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (document.visibility === 'company') return true;
  return caller.id === document.employeeId;
}

// --- Performance ---

/** Company goals are published to everyone; only HR edits them. */
export function canViewCompanyGoals(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

export function canManageCompanyGoals(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/** Objectives and deliverables follow the employment band: self, line manager, HR. */
export function canViewObjectives(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

export function canManageObjectives(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  // An employee can set and update their own objectives; a manager can set their report's.
  // Both are normal, and requiring HR for either would make the feature unused.
  return isSelf(caller, target) || isLineManagerOf(caller, target) || isHrAdmin(caller);
}

export function canViewOneToOne(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

/**
 * The manager's private notes on a one-to-one. Visible to the manager who holds the
 * relationship and to HR — never to the employee the notes are about.
 *
 * This is the uncomfortable one, so the reasoning is written down: a manager with nowhere to
 * record a private impression keeps it out of the system entirely, in a notebook or their
 * head, where HR cannot see it either. A clearly bounded private field is the better of two
 * imperfect options. It is not a place for anything that should be in a formal record, and it
 * is disclosable to the employee on a subject access request regardless of this predicate.
 */
export function canViewOneToOnePrivateNotes(
  caller: ActiveEmployee,
  oneToOne: { employeeId: string; managerEmployeeId: string | null }
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (caller.id === oneToOne.employeeId) return false;
  return caller.id === oneToOne.managerEmployeeId || isHrAdmin(caller);
}

export function canManageOneToOne(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  // Deliberately excludes self: a one-to-one is a record of a conversation between two people,
  // and one somebody logs about themselves is not that.
  if (isSelf(caller, target)) return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller);
}

export function canViewAppraisal(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

/** Writing the self-review half is the employee's; the manager half and the rating are not. */
export function canWriteSelfReview(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target);
}

export function canWriteManagerReview(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isSelf(caller, target)) return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller);
}

// --- Engagement ---

/** Anyone may recognise anyone. A recognition wall with a permission tier is not one. */
export function canGiveKudos(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

export function canRespondToSurvey(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

export function canManageSurveys(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/**
 * Survey results. HR only, and even HR gets aggregates for an anonymous survey because the
 * identity was never recorded — see the comment on `survey_responses.employeeId`.
 */
export function canViewSurveyResults(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

// --- Rotas, timesheets and clocking ---

/** Seeing who is working when. Follows the employment band. */
export function canViewShift(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

/** Building the rota. A line manager schedules their own reports; HR schedules anyone. */
export function canManageRota(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller);
}

export function canRequestShiftSwap(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  // Only the person rostered can offer their own shift away.
  return isSelf(caller, target);
}

/**
 * Approving a swap two employees have already agreed between themselves.
 *
 * Separate from accepting it, and never available to either party: a swap that needs only the
 * other person's agreement lets two employees rewrite the published rota between them, which
 * is the thing a rota exists to prevent.
 */
export function canApproveShiftSwap(
  caller: ActiveEmployee,
  swap: { requestedByEmployeeId: string; acceptedByEmployeeId: string | null },
  requesterManagerId: string | null
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (caller.id === swap.requestedByEmployeeId || caller.id === swap.acceptedByEmployeeId) {
    return false;
  }
  return isHrAdmin(caller) || requesterManagerId === caller.id;
}

export function canViewTimesheet(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

/** Filling in and submitting hours is the employee's own act; HR can correct on their behalf. */
export function canEditTimesheet(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target) || isHrAdmin(caller);
}

/** Nobody approves their own hours, for the same reason nobody approves their own leave. */
export function canApproveTimesheet(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isSelf(caller, target)) return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller);
}

/** Clocking in and out is always self-only — a clock record someone else made is not one. */
export function canClock(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target);
}

/** Correcting a mis-clock is a manager's job, and is recorded as a correction. */
export function canCorrectClockEvent(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isSelf(caller, target)) return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller);
}

// --- Expenses ---

/**
 * Seeing a claim. Adds finance users to the employment band, since a finance user is
 * entitled to spend figures across the company in the same way they are to pay.
 */
export function canViewExpenseClaim(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (caller.financeAccess) return true;
  return canViewEmployeeRecord(caller, target);
}

export function canEditExpenseClaim(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target);
}

/** Nobody approves their own spend. */
export function canApproveExpenseClaim(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isSelf(caller, target)) return false;
  return isLineManagerOf(caller, target) || isHrAdmin(caller) || caller.financeAccess;
}

/**
 * Marking a claim paid is finance's act, deliberately separate from approving it. Approval
 * says the spend was legitimate; payment says the money left the account, and the same person
 * doing both unchecked is the classic expenses control gap.
 */
export function canMarkExpensePaid(caller: ActiveEmployee): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return caller.financeAccess || isHrAdmin(caller);
}

export function canManageExpenseSettings(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

// --- Learning ---

/** The course catalogue is published to everyone; only HR adds to it. */
export function canViewCourses(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

export function canManageCourses(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

export function canViewEnrolment(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  return canViewEmployeeRecord(caller, target);
}

/** Assigning training to someone. A manager does it for their reports; HR for anyone. */
export function canAssignCourse(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target) || isLineManagerOf(caller, target) || isHrAdmin(caller);
}

/** Only the learner marks their own progress. A manager recording it for them is a fiction. */
export function canUpdateOwnEnrolment(caller: ActiveEmployee, target: HrEmployeeTarget): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isSelf(caller, target) || isHrAdmin(caller);
}

// --- Health and safety ---

/**
 * Risk assessments are visible to everyone. A control measure nobody can read protects
 * nobody, and hiding the assessment for the room someone works in serves no purpose.
 */
export function canViewRiskAssessments(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

export function canManageRiskAssessments(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

/**
 * Anyone can report a hazard, a near miss or an accident — including one that happened to
 * someone else. A reporting channel with a permission tier is a reporting channel that does
 * not get used, and under-reporting is the failure mode safety systems actually have.
 */
export function canReportIncident(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

/**
 * Reading the incident log. Everyone sees that something happened, where, and what was done
 * about it, because that is how people learn to avoid it.
 */
export function canViewIncidentLog(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

/**
 * Injury detail and investigation notes. Health data about a named person, so it follows the
 * same rule as sickness: the person themselves, and HR. Not the wider company, who can still
 * see that an accident occurred and what changed as a result.
 */
export function canViewIncidentInjuryDetail(
  caller: ActiveEmployee,
  incident: { affectedEmployeeId: string | null }
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  if (isHrAdmin(caller)) return true;
  // An incident with nobody named carries no personal data, so its detail is not restricted.
  if (incident.affectedEmployeeId === null) return true;
  return caller.id === incident.affectedEmployeeId;
}

export function canInvestigateIncident(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

// --- Recruitment ---

/**
 * Vacancies and candidates.
 *
 * Scoped to HR and the named hiring manager rather than to the line-management chain, because
 * a candidate is not an employee and has no place in it. Everyone else sees open vacancies
 * (internal moves and referrals depend on that) and none of the applications.
 */
export function canViewVacancies(caller: ActiveEmployee): boolean {
  return hrScopeFor(caller) !== 'none';
}

export function canManageVacancies(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}

export function canViewApplications(
  caller: ActiveEmployee,
  vacancy: { hiringManagerEmployeeId: string | null }
): boolean {
  if (hrScopeFor(caller) === 'none') return false;
  return isHrAdmin(caller) || caller.id === vacancy.hiringManagerEmployeeId;
}

export function canManageApplications(
  caller: ActiveEmployee,
  vacancy: { hiringManagerEmployeeId: string | null }
): boolean {
  return canViewApplications(caller, vacancy);
}

/**
 * Turning a hired candidate into an employee record. HR only, and deliberately narrower than
 * managing the application: moving someone to "hired" is a recruitment decision, but creating
 * an account and an employment record is an HR act with payroll and access consequences.
 */
export function canConvertApplicantToEmployee(caller: ActiveEmployee): boolean {
  return isHrAdmin(caller);
}
