import type { DraftingProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured, not a throw: every part of a `BusinessShape` is already
 * configurable by hand, so a deployment with no drafting is complete, not broken (D31).
 * Decided by whether `apps/api` is reachable, not by whether a model key exists — that key, and
 * which model drafts, is the other runtime's own decision (D34, D62), exactly as for answering.
 */
export async function draftingProvider(): Promise<DraftingProvider | null> {
  const baseUrl = process.env.ASSISTANT_API_URL;
  if (!baseUrl) return null;

  const { goldApiDraftingProvider } = await import('./gold-api');
  return goldApiDraftingProvider({ baseUrl });
}
