import type { PlatformEmailSender } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. `null` when this deployment has no API to relay to, the same no-dead-end reasoning
 * `apps/web/lib/adapters/domains/registry.ts` already gives for a hosting credential: a
 * deployment with no `apps/api` configured sends no platform email, and the invitation it creates
 * still gets its copyable link.
 *
 * Takes the caller's own token, the same shape `domainProvider({ token })` already holds — this
 * adapter forwards it to `apps/api`, which proves the caller may act on the one invitation named,
 * never trusting a recipient or a subject line this deployment did not derive itself.
 */
export async function platformEmailSender(input: { token: string }): Promise<PlatformEmailSender | null> {
  if (!process.env.GOLD_API_URL) return null;

  const { goldApiPlatformEmailSender } = await import('./gold-api');
  return goldApiPlatformEmailSender(input);
}
