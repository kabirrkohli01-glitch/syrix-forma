# SYRIX Forma — Data Classification (draft)

Status: Phase 0 draft. Every data type introduced in later phases must be assigned one of
these levels before it ships — this file is referenced by engineering rule 11 and
the build plan Phase 5 (document retention) and Phase 7 (SYRIX AI access).

## Levels

### PUBLIC
- Visibility: anyone, including outside SYRIX Forma (e.g. marketing content).
- AI access: unrestricted.
- Export: unrestricted.
- Retention: indefinite.

### INTERNAL
- Visibility: any authenticated SYRIX Forma employee.
- AI access: allowed for SYRIX AI (Phase 7), subject to prompt-injection safeguards.
- Export: allowed, logged.
- Retention: per standard policy (to be set before Phase 9).

### CONFIDENTIAL
- Visibility: role/assignment-scoped only (e.g. a client's assigned staff, their team lead,
  managers with cross-team visibility). Default level for client and project data.
- AI access: only within the scope the requesting user already has — never standing access
  (engineering rule 12).
- Export: requires approval step-up (Phase 5 Approvals).
- Retention: per data-classification + legal requirement; reviewed at Phase 9.

### HIGHLY CONFIDENTIAL
- Visibility: named individuals only, or SECURITY_ADMIN for security-specific data (e.g.
  audit logs, session data, security events).
- AI access: hard-blocked — SYRIX AI must never have standing access to this tier
  (the build plan Phase 7).
- Export: requires approval step-up + audit entry, restricted to ADMIN/SECURITY_ADMIN as
  appropriate.
- Retention: strictest policy; subject to formal DR/backup rules at Phase 9.

## Applying levels (to fill in as entities are built)

| Data type | Level |
|---|---|
| Employee directory (name, team, role) | INTERNAL |
| Client records, projects, tasks | CONFIDENTIAL |
| Audit log, session data, security events | HIGHLY CONFIDENTIAL |
| Automation run history | INTERNAL |
| Documents (reference links, Phase 5) | inherits the linked client/project's level |
| Team Chat messages & attachments | CONFIDENTIAL |

This table is not exhaustive — extend it whenever a new entity is added, rather than
defaulting a new data type to INTERNAL without deciding.

Team Chat is CONFIDENTIAL under this table's "role/assignment-scoped only" visibility rule —
the assignment here is conversation participancy rather than team/client staffing, but the
same tier's AI/export/retention rules apply unchanged: SYRIX AI never gets standing access to
chat content, and export would need Approvals step-up once an export feature exists.

## HR data (added with the HR module)

HR is the first data in this app that is *special category* personal data under UK GDPR
Article 9 (health, in the sickness records that follow in Stage 2) and financial personal data
(pay and bank details). It does not fit the "role/assignment-scoped" reading of CONFIDENTIAL
that client and project data uses, because HR access is not assignment-scoped — it follows the
line management chain and the HR role. The table below assigns a level per band.

| Data type | Level |
|---|---|
| Job title, contract type, start/leaving date, working pattern | CONFIDENTIAL |
| Training records and certification expiry | CONFIDENTIAL |
| Date of birth, home address, personal contact details, emergency contact | HIGHLY CONFIDENTIAL |
| National Insurance number | HIGHLY CONFIDENTIAL |
| Salary, hourly rate, pay frequency | HIGHLY CONFIDENTIAL |
| Bank account name, sort code, account number | HIGHLY CONFIDENTIAL |
| Custom field values | CONFIDENTIAL by default; HIGHLY CONFIDENTIAL if the field holds any of the above |

The HIGHLY CONFIDENTIAL tier's existing rules apply unchanged, with two clarifications this data
forces:

- **"Named individuals only"** resolves here to: the employee themselves, HR_ADMIN, and — for
  the pay band only — finance users. It explicitly does not include ADMIN. See
  `docs/permissions-matrix.md`; platform administration is not HR access.
- **AI access is hard-blocked.** SYRIX AI must never be given standing access to any row in
  `employee_profiles` or `employee_pay`. This is the tier's existing rule, restated because HR
  is the first place in the app where a plausible-sounding assistant question ("what does X
  earn?") maps directly onto a HIGHLY CONFIDENTIAL column.

Encryption at rest is applied *in addition to* the managed-Postgres default for the fields most
damaging in a database leak — National Insurance number, salary, hourly rate and bank details —
via `lib/hr/crypto.ts`. The remaining HIGHLY CONFIDENTIAL fields (date of birth, home address)
are not separately encrypted; they are protected by access control and the managed database's
own at-rest encryption. That split is a deliberate line, not an oversight: encrypting a column
costs the ability to query it, and it is worth paying for the fields that are directly
monetisable if leaked.

**Still to be decided before real employee data is entered** (not claimed as done): retention
periods for leavers' records, which UK statutory minimums (payroll records, working time
records) set floors for, and the subject access request path — an employee asking for
everything the Hub holds about them. Both belong with the Phase 9 retention work rather than
being invented here, but neither should be discovered for the first time at that point.

## HR: candidate data (added with the recruitment module)

| Data type | Level |
|---|---|
| Candidate name, email, phone, CV, cover note | CONFIDENTIAL |
| Interview feedback and ratings | CONFIDENTIAL |
| Incident injury detail and investigation notes | HIGHLY CONFIDENTIAL |
| Course enrolments and completion records | INTERNAL |

Candidate records are personal data about people **outside** the company, which makes their
retention question different from an employee's rather than a subset of it: there is no
employment relationship to justify holding them, and the lawful basis runs out when the
vacancy closes. A retention period for unsuccessful applicants has to be set before real
candidate data is entered — it is not decided here, and it is not safe to default to
"indefinitely" the way the rest of this app currently does.

Injury detail sits in the HIGHLY CONFIDENTIAL tier for the same reason sickness detail does:
it is health data under UK GDPR Article 9. The rest of an incident record is deliberately not
— everyone needs to be able to read what happened and what changed as a result.
