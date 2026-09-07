import type { TelephonyProvider } from './index';

/**
 * Which implementation this deployment uses.
 *
 * **The only file outside an implementation that names a carrier**, exactly as
 * `payments/registry.ts` is for processors. Everything above it names the capability.
 *
 * `null` when nothing is configured, rather than a throw. A business that dials from mobile
 * phones and writes down what happened is a complete business, and on a deployment with no
 * carrier configured that is what this platform offers: the call is recorded by hand, and the
 * button that would have dialled says why it cannot (D31).
 *
 * **Five values rather than two, and the extra three are what a dialer costs.** Placing a call
 * from a server needs an account and its token. Letting a *browser* be a telephone needs an API
 * key to sign a short-lived credential with, and an application at the carrier to point that
 * credential at. A deployment holding the first two and not the last three can record calls and
 * cannot make them, which is a real state and the reason this returns null rather than half a
 * provider.
 *
 * **Selection is by environment rather than by tenant, and D39 says why that survives.** Each
 * business gets a subaccount of the account named here, and what is stored against a business is
 * a subaccount identifier rather than a credential — so this function grows an organization
 * argument when the number inventory lands, and nothing above it changes.
 */
export async function telephonyProvider(): Promise<TelephonyProvider | null> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const appSid = process.env.TWILIO_TWIML_APP_SID;

  if (!account || !token || !apiKeySid || !apiKeySecret || !appSid) return null;

  const { twilioTelephony } = await import('./twilio');
  return twilioTelephony({ account, token, apiKeySid, apiKeySecret, appSid });
}

/**
 * The number this deployment calls from, or null.
 *
 * **Read here rather than in the domain layer**, because *which number* is a fact about how this
 * deployment is wired and the domain has no business knowing there is only one. When the number
 * inventory lands, the domain asks the tenant's rows instead and this export disappears — which
 * is why nothing else in the repository is allowed to read the variable directly.
 */
export function callingNumber(): string | null {
  return process.env.TELEPHONY_FROM_NUMBER || null;
}

/**
 * Where the carrier should report what happens next.
 *
 * The public base of this repository's own `apps/api` deployment. **Passed per call rather than
 * configured once at the carrier**, so a deployment that moves does not leave its calls
 * reporting to an address that no longer answers — and so a preview and production can run side
 * by side without one of them collecting the other's callbacks.
 *
 * Separate from the assistant's base URL, which usually points at the same deployment: the two
 * features are separately configurable everywhere else in this repository, and folding them into
 * one variable would make either switch turn the other off.
 */
export function callbackBase(): string | null {
  const base = process.env.TELEPHONY_CALLBACK_URL;
  return base ? base.replace(/\/+$/, '') : null;
}
