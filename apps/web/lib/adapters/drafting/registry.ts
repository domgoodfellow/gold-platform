import type { DraftingProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured, not a throw: every part of a `BusinessShape` is already
 * configurable by hand, so a deployment with no drafting is complete, not broken (D31).
 * Selected by environment, not by tenant — the platform is asking on the business's behalf.
 */
export async function draftingProvider(): Promise<DraftingProvider | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { anthropicDraftingProvider } = await import('./anthropic');
  return anthropicDraftingProvider({ apiKey });
}
