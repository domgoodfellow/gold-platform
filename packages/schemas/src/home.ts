import { z } from 'zod';

/** Home receives Studio metadata, never revision editor content. */
export const HomeStudioSummarySchema = z.object({
  workingTotal: z.number().int().nonnegative(),
  draftTotal: z.number().int().nonnegative(),
  working: z.array(z.object({ id: z.string().uuid(), status: z.enum(['draft', 'in_review']), revision_number: z.number().int(), created_at: z.string().datetime({ offset: true }) })).max(5),
  drafts: z.array(z.object({ id: z.string().uuid(), form_id: z.string().uuid(), name: z.string(), created_at: z.string().datetime({ offset: true }) })).max(5),
  published: z.array(z.object({ id: z.string().uuid(), revision_number: z.number().int(), published_at: z.string().datetime({ offset: true }) })).max(5),
});
