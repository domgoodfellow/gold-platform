import type { AnsweringProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured: every screen works without the assistant, just more slowly
 *. Decided by whether `apps/api` is reachable, not by whether a model key exists — that
 * key, and which model answers, is the other runtime's own decision.
 */
export async function answeringProvider(): Promise<AnsweringProvider | null> {
  const baseUrl = process.env.ASSISTANT_API_URL;
  if (!baseUrl) return null;

  const { goldApiAnsweringProvider } = await import('./gold-api');
  return goldApiAnsweringProvider({ baseUrl });
}
