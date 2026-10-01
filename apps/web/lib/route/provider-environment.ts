/**
 * Deployment-level readiness for a Provider with no account model — an environment variable
 * either holds a credential a real GOLD adapter uses, or it does not. Route-owned, not
 * `lib/domain/`: naming a vendor to read its own environment variable is exactly what I15
 * reserves for an adapter or its caller, never the domain layer (`adapters.test.ts`).
 *
 * Never "configured" merely because a variable name is set: `anthropic` and `resend` both have
 * an adapter behind them (`lib/adapters/drafting`, the invitation mailer); a Provider catalogued
 * with no adapter at all (`google`, `openai`, today) has no environment variable this could even
 * read, so it answers 'not_implemented' rather than guessing at one (section 42).
 */
export function credentialEnvironmentState(providerKey: string): 'configured' | 'not_configured' | 'not_implemented' {
  if (providerKey === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'configured' : 'not_configured';
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
