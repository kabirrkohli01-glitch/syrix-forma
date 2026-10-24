import { z } from 'zod';

/** `YYYY-MM-DD`, and a real date — `2026-02-31` parses as a string but is not a day. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Not a real date');

export const leaveUnitSchema = z.enum(['full', 'am', 'pm']);

export const requestLeaveSchema = z
  .object({
    // Omitted means "for myself". Present means booking on someone's behalf, which
    // canRequestLeaveFor gates to HR.
    employeeId: z.uuid().optional(),
    leaveTypeId: z.uuid(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    startUnit: leaveUnitSchema.default('full'),
    endUnit: leaveUnitSchema.default('full'),
    reason: z.string().trim().max(2000).optional()
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate']
  });

export type RequestLeaveInput = z.input<typeof requestLeaveSchema>;

export const decideLeaveSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(['approved', 'declined']),
  note: z.string().trim().max(2000).optional()
});

export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;

export const cancelLeaveSchema = z.object({
  requestId: z.uuid(),
  reason: z.string().trim().max(2000).optional()
});

export const recordSicknessSchema = z
  .object({
    employeeId: z.uuid().optional(),
    startDate: isoDateSchema,
    // Absent means the person has not returned yet — the record stays open.
    endDate: isoDateSchema.optional(),
    category: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(4000).optional(),
    isSelfCertified: z.boolean().default(true)
  })
  .refine((value) => !value.endDate || value.startDate <= value.endDate, {
    message: 'The return date cannot be before the first day of absence',
    path: ['endDate']
  });

export type RecordSicknessInput = z.input<typeof recordSicknessSchema>;

export const closeSicknessSchema = z.object({
  sicknessRecordId: z.uuid(),
  endDate: isoDateSchema
});

export const recordReturnToWorkSchema = z.object({
  sicknessRecordId: z.uuid(),
  conductedOn: isoDateSchema,
  notes: z.string().trim().max(4000).optional(),
  adjustmentsAgreed: z.string().trim().max(4000).optional()
});

export const upsertLeaveAllowanceSchema = z.object({
  employeeId: z.uuid(),
  leaveYearStart: isoDateSchema,
  // Entered by HR in days and converted at the boundary; storage is half days throughout.
  entitlementDays: z.number().min(0).max(366).multipleOf(0.5),
  carriedOverDays: z.number().min(0).max(366).multipleOf(0.5).default(0),
  adjustmentDays: z.number().min(-366).max(366).multipleOf(0.5).default(0),
  adjustmentNote: z.string().trim().max(1000).optional()
});

export const upsertLeaveTypeSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  deductsFromAllowance: z.boolean().default(true),
  isPaid: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #3b82f6')
    .optional()
});

export const addPublicHolidaySchema = z.object({
  date: isoDateSchema,
  name: z.string().trim().min(1).max(200),
  region: z.string().trim().min(1).max(100).default('England and Wales')
});

export const updateLeaveSettingsSchema = z.object({
  leaveYearStartMonth: z.number().int().min(1).max(12),
  leaveYearStartDay: z.number().int().min(1).max(31),
  defaultEntitlementDays: z.number().min(0).max(366).multipleOf(0.5),
  carryOverMaxDays: z.number().min(0).max(366).multipleOf(0.5),
  carryOverExpiryMonths: z.number().int().min(0).max(24),
  allowNegativeBalance: z.boolean()
});
