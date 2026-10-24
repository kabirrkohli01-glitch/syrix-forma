'use server';

import { z } from 'zod';
import { toCsv } from '@/lib/hr/csv';
import { logAuditEvent } from '@/lib/permissions/audit';
import { requireActiveEmployee } from '@/lib/permissions/current-employee';
import { canExportPayroll } from '@/lib/permissions/hr-access';
import { HrError } from './utils/errors';
import { isoDateSchema } from './utils/leave-schemas';
import { getPayrollChanges } from './utils/report-queries';

const exportSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((value) => value.from <= value.to, {
    message: 'The end of the period cannot be before the start',
    path: ['to']
  });

/**
 * Payroll export: everything that changed about what people are paid, for a period, as CSV.
 *
 * Three controls stack here, deliberately, because this is the single highest-value file the
 * application can produce:
 *
 *   1. `canExportPayroll` — HR administrators and finance users only.
 *   2. An audit entry recording who exported what period and how many rows, written whether
 *      or not the export succeeds in reaching them.
 *
 * The file deliberately excludes standing salaries — see `getPayrollChanges`. A payroll run
 * needs the deltas; the salaries are already in the payroll system, and exporting them every
 * month would widen what this file costs if it leaks for no additional use.
 */
export async function exportPayrollCsv(input: { from: string; to: string }) {
  const caller = await requireActiveEmployee();

  if (!canExportPayroll(caller)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'payroll_exported',
      resourceType: 'payroll_export',
      resourceId: null,
      result: 'denied',
      metadata: { from: input.from, to: input.to }
    });
    throw new HrError('You cannot export payroll data');
  }

  const parsed = exportSchema.parse(input);

  const changes = await getPayrollChanges(parsed.from, parsed.to);

  const csv = toCsv(
    ['Employee', 'Employee ID', 'Change', 'Detail', 'Amount'],
    changes.map((change) => [
      change.employeeName,
      change.employeeId,
      change.kind.replaceAll('_', ' '),
      change.detail,
      change.amount
    ])
  );

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'payroll_exported',
    resourceType: 'payroll_export',
    resourceId: null,
    result: 'success',
    // Period and row count, never the contents. An audit log that reproduces the export is a
    // second copy of the thing being protected.
    metadata: { from: parsed.from, to: parsed.to, rowCount: changes.length }
  });

  return {
    filename: `payroll-changes-${parsed.from}-to-${parsed.to}.csv`,
    csv,
    rowCount: changes.length
  };
}
