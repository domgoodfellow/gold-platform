import { z } from 'zod';

/**
 * What a server action validates before ever reaching the domain layer or the database — the
 * domain layer and its RLS policies remain the actual authority (a schema here is a better error
 * message, never a second place authorization is decided).
 */

export const InviteMemberSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  roleId: z.string().uuid(),
});
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const StartSupportSessionSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type StartSupportSessionInput = z.infer<typeof StartSupportSessionSchema>;

/**
 * A Plan key and the opaque version of the quote the person reviewed — never a price, an amount or
 * a customer id. The domain layer rebuilds the quote and refuses if it is no longer that version.
 */
export const PlatformBillingCheckoutSchema = z.object({
  organizationId: z.string().uuid(),
  planKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,60}$/),
  quoteVersion: z.string().trim().regex(/^[a-f0-9]{64}$/),
});
export type PlatformBillingCheckoutInput = z.infer<typeof PlatformBillingCheckoutSchema>;

export * from './forms';
export * from './website';
export { HomeStudioSummarySchema } from './home';
