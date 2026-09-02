import type { DraftingProvider } from './index';

/**
 * Which implementation this deployment uses.
 *
 * The same shape as `adapters/payments/registry.ts` and `adapters/geocoding/registry.ts`,
 * deliberately: **the only file outside an implementation that names a provider**, and `null`
 * when nothing is configured rather than a throw.
 *
 * **A deployment with no drafting is a complete deployment.** Every part of a `BusinessShape`
 * has a screen that predates this one — work item types, statuses, transitions, fields, prices,
 * hours and roles are all configurable by hand, and were for three milestones before anything
 * could draft them. Drafting is the faster answer and not the only one, which is precisely why
 * it is a module a business can decline rather than kernel.
 *
 * **What null obliges the caller to do is say so.** D31 was written from a switch that could be
 * turned on while the section it configured was hidden behind exactly this kind of null, and
 * the business was told nothing — which from the operator's side is what finishing looks like.
 * So a deployment holding no key does not hide the module: it says there is nothing behind it
 * and points at the screens that still work.
 *
 * **Selection is by environment rather than by tenant**, the same as geocoding and the opposite
 * of D27's payment case. Nothing about drafting is a tenant's relationship with anybody: the
 * platform asks on their behalf and hands them back a document they own. A per-tenant key would
 * be a tenant's account with a vendor, which is a different feature with a different record.
 */
export async function draftingProvider(): Promise<DraftingProvider | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { anthropicDraftingProvider } = await import('./anthropic');
  return anthropicDraftingProvider({ apiKey });
}
