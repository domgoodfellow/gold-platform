import type { EmailProvider } from './index';

/**
 * Which implementation this deployment uses — the one file outside an implementation that would
 * name a vendor, as `../messaging/registry.ts` is for text.
 *
 * Takes the caller's own token, the shape `platformEmailSender({ token })` already holds: the
 * implementation forwards it to `apps/api`, which proves the caller may send this one message and
 * resolves the credential itself. `null` when this deployment has no API to relay to: a
 * deployment that cannot send email says so rather than accepting a message it can never deliver.
 */
export async function emailProvider(input: { token: string }): Promise<EmailProvider | null> {
  if (!process.env.GOLD_API_URL) return null;

  const { goldApiEmailProvider } = await import('./gold-api');
  return goldApiEmailProvider(input);
}
