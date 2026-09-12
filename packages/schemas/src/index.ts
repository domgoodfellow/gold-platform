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
