import type { MessagingProvider } from './index';

/**
 * Which implementation this deployment uses — the one file outside an implementation that names
 * a carrier, exactly as `../telephony/registry.ts` is for calling.
 *
 * `null` when nothing is configured, the same D31 reasoning `telephonyProvider` states: a
 * deployment that cannot send yet must say so, never silently do nothing.
 */
export async function messagingProvider(): Promise<MessagingProvider | null> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!account || !token) return null;

  const { twilioMessaging } = await import('./twilio');
  return twilioMessaging({ account, token });
}

/** The one place this capability spells a carrier's name for `platform_providers.key`/`organization_provider_resources.resource_type`. */
export function messagingProviderKey(): string {
  return 'twilio';
}

/** Where the carrier should report delivery — same base `../telephony` already uses, this capability's own path suffix. */
export function messagingCallbackBase(): string | null {
  const base = process.env.TELEPHONY_CALLBACK_URL;
  return base ? base.replace(/\/+$/, '') : null;
}
