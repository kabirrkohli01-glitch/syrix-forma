import { z } from 'zod';
import { describeUrlProblem } from '@/lib/connectors/url-guard';

/**
 * A URL the Hub is willing to make a server-side request to.
 *
 * The rule itself lives in `lib/connectors/url-guard.ts` so the probes apply exactly the same one
 * at the moment they fetch. Validating here alone would leave the check on the way in but not on
 * the way out, and a connector re-tested later would skip it entirely.
 */
const connectorUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .superRefine((value, ctx) => {
    const problem = describeUrlProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const saveMcpConnectorSchema = z.object({
  connectorId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give it a name').max(100),
  baseUrl: connectorUrl,
  /** Omitted on an update means "leave the stored token alone"; an empty string clears it. */
  token: z.string().trim().max(4000).optional()
});

export type SaveMcpConnectorInput = z.input<typeof saveMcpConnectorSchema>;

export const saveHttpConnectorSchema = z.object({
  connectorId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give it a name').max(100),
  baseUrl: connectorUrl,
  headerName: z
    .string()
    .trim()
    .min(1, 'Name the header')
    .max(100)
    // A header name carrying a newline or a colon would let its value continue into a second,
    // forged header. Restricted to the characters an HTTP field name may actually contain.
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'That is not a valid header name'),
  headerValue: z.string().trim().max(4000).optional()
});

export type SaveHttpConnectorInput = z.input<typeof saveHttpConnectorSchema>;
