/**
 * Deployment-level readiness for a Provider with no account model — an environment variable
 * either holds a credential a real GOLD adapter uses, or it does not. Route-owned, not
 * `lib/domain/`: naming a vendor to read its own environment variable is exactly what I15
 * reserves for an adapter or its caller, never the domain layer (`adapters.test.ts`).
 *
 * Never "configured" merely because a variable name is set. No provider reads one in this runtime
 * any more: the model providers' credentials are Provider Accounts read by `apps/api`, and
 * `apps/web` holds no model key at all (configuration drafting runs there too). A Provider with
 * no account model and no environment variable this could read answers 'not_implemented' rather
 * than guessing at one (section 42).
 */
export function credentialEnvironmentState(): 'configured' | 'not_configured' | 'not_implemented' {
  return 'not_implemented';
}

/**
 * Providers with the generic, API-key-only account model (`ProviderConfiguration`) rather than
 * Twilio's own subaccount/binding one, or the environment-only path above. Route-owned for the
 * same reason `credentialEnvironmentState` is: naming which providers this platform built account
 * UI for is a fact about this deployment's routes, never something `lib/domain/` may say (I15).
 * Named once so the Providers list and a Provider's own detail route agree.
 *
 * `resend` joined this set once platform email moved onto `platform_provider_accounts` (D62,
 * work order 1 §6); `RESEND_API_KEY`/`PLATFORM_EMAIL_FROM_ADDRESS` are the bootstrap fallback
 * `app.services.platform_email` tries when no account is recorded, never a second UI for it.
 */
export const GENERIC_ACCOUNT_PROVIDER_KEYS = new Set(['openai', 'anthropic', 'google', 'vercel', 'resend']);

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
