import type { PlatformEmailSender } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured: the invite still gets created and its link still gets
 * shown to copy, exactly as `apps/api/app/channels/registry.py:sender_for` treats an
 * unconfigured tenant channel — a deployment with no email set up is a complete deployment, not
 * a broken one.
 *
 * A deliberately separate credential and sender address from a tenant's own channel
 * (`RESEND_API_KEY`/`MESSAGE_FROM_ADDRESS` in `apps/api`), even though both may end up pointing
 * at the same Resend account in practice — GOLD's own platform mail must never be confused with
 * a tenant's metered, billed sends.
 */
export async function platformEmailSender(): Promise<PlatformEmailSender | null> {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.PLATFORM_EMAIL_FROM_ADDRESS;
  if (!apiKey || !sender) return null;

  const { resendPlatformEmailSender } = await import('./resend');
  return resendPlatformEmailSender({ apiKey, sender });
}
