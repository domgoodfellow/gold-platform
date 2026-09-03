import type { AnsweringProvider } from './index';

/**
 * Which implementation this deployment uses.
 *
 * The same shape as the other three registries: **the only file outside an implementation that
 * names one**, and `null` when nothing is configured rather than a throw.
 *
 * **A deployment with no answering is a complete deployment.** Every screen works without it —
 * the schedule, the board, the job page and the reports all answer the same questions more
 * slowly and by hand. That is what makes the assistant a module a business can decline rather
 * than kernel, and it is why `null` here must produce a sentence on screen rather than a missing
 * section (D31).
 *
 * **What decides it is whether `apps/api` is deployed and reachable**, not whether a model key
 * exists. The key lives in the other runtime, and which model answers is that deployment's
 * decision — a hosted one, or something on the business's own hardware, with nothing here
 * knowing the difference (D34). This file cannot tell whether that side has a model configured,
 * so it does not pretend to: a deployment that has set the URL and left the far side
 * unconfigured gets the far side's own sentence back, which says exactly that.
 */
export async function answeringProvider(): Promise<AnsweringProvider | null> {
  const baseUrl = process.env.ASSISTANT_API_URL;
  if (!baseUrl) return null;

  const { goldApiAnsweringProvider } = await import('./gold-api');
  return goldApiAnsweringProvider({ baseUrl });
}
