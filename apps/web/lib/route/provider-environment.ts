/**
 * Providers with the generic, API-key-only account model (`ProviderConfiguration`) rather than
 * Twilio's own subaccount/binding one. Route-owned: naming which
 * providers this platform built account UI for is a fact about this deployment's routes, never
 * something `lib/domain/` may say. Named once so the Providers list and a Provider's own
 * detail route agree, and held to the API's own registry (`app.providers.providers.operations_for`)
 * by `provider-account-adapters.test.ts`, so the two lists cannot drift apart.
 *
 * `resend` joined this set once platform email moved onto `platform_provider_accounts` (the platform-provider-account rule,
 * work order 1 §6); `RESEND_API_KEY`/`PLATFORM_EMAIL_FROM_ADDRESS` are the bootstrap fallback
 * `app.services.platform_email` tries when no account is recorded, never a second UI for it.
 */
export const GENERIC_ACCOUNT_PROVIDER_KEYS = new Set(['openai', 'anthropic', 'google', 'vercel', 'resend', 'voice_agent']);

/**
 * Whether GildOps' own platform invitation email can send right now, and from where -- Resend's
 * one piece of presentation the generic `ProviderConfiguration` does not already show (work order
 * 1 closeout, section 7). Route-owned for the same reason as the rest of this file: naming
 * `PLATFORM_EMAIL_FROM_ADDRESS` is reading this deployment's own environment, never something
 * `lib/domain/` may do. Mirrors `app.services.platform_email`'s own precedence exactly: the
 * account answers only once it is active and holds a credential; the environment variable pair is
 * the bootstrap fallback tried next; the sender address is always read from the environment,
 * whichever credential answers.
 */
export function platformEmailOperationalStatus(account: { status: string; credentialSetAt: string | null } | null): {
  canSend: boolean;
  source: 'account' | 'environment' | 'none';
  senderAddress: string | null;
} {
  const senderAddress = process.env.PLATFORM_EMAIL_FROM_ADDRESS ?? null;
  const accountReady = Boolean(account && account.status === 'active' && account.credentialSetAt);
  const environmentReady = Boolean(process.env.RESEND_API_KEY);

  if (accountReady) return { canSend: Boolean(senderAddress), source: 'account', senderAddress };
  if (environmentReady) return { canSend: Boolean(senderAddress), source: 'environment', senderAddress };
  return { canSend: false, source: 'none', senderAddress };
}
