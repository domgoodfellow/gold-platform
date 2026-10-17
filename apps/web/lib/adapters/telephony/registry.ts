import type {
  TelephonyAccountOperations,
  TelephonyCredentialKind,
  TelephonyProvider,
  TelephonyProvisioner,
} from './index';

/**
 * Which implementation this deployment uses.
 *
 * **The only file outside an implementation that names a carrier**, exactly as
 * `payments/registry.ts` is for processors. Everything above it names the capability.
 *
 * `null` when nothing is configured, rather than a throw. A business that dials from mobile
 * phones and writes down what happened is a complete business, and on a deployment with no
 * carrier configured that is what this platform offers: the call is recorded by hand, and the
 * button that would have dialled says why it cannot.
 *
 * **Five values rather than two, and the extra three are what a dialer costs.** Placing a call
 * from a server needs an account and its token. Letting a *browser* be a telephone needs an API
 * key to sign a short-lived credential with, and an application at the carrier to point that
 * credential at. A deployment holding the first two and not the last three can record calls and
 * cannot make them, which is a real state and the reason this returns null rather than half a
 * provider.
 *
 * **Selection is still by environment — GOLD's master account is always the credential — and
 * the telephony-identity design is why an organization argument does not change that.** A business's subaccount is a scope
 * inside GOLD's own account, not a second set of credentials: Twilio lets the parent's own
 * Account SID and auth token address a resource under any of its subaccounts by naming that
 * subaccount's SID in the request path. `actingAccountSid` is exactly that name. Passed, calls
 * happen inside that business's own scope; omitted, they happen inside GOLD's master scope
 * exactly as before this argument existed — a business with no Twilio binding yet is unaffected.
 *
 * The credential that mints a *browser's* token (`browserToken`) is unaffected by this argument.
 * A token granting access to one subaccount's own TwiML application can only be signed by an API
 * key belonging to that same subaccount, which is a deeper resolution — safely reading that
 * business's own generated key back out of Vault at the moment of signing — that this slice does
 * not build; the platform-economics separation (ADR-014) names it as what is not yet built here.
 */
export async function telephonyProvider(
  actingAccountSid?: string | null,
): Promise<TelephonyProvider | null> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const appSid = process.env.TWILIO_TWIML_APP_SID;

  if (!account || !token || !apiKeySid || !apiKeySecret || !appSid) return null;

  const { twilioTelephony } = await import('./twilio');
  return twilioTelephony({ account, token, apiKeySid, apiKeySecret, appSid, actingAccountSid });
}

/**
 * Standing up a new subaccount, its key and its application — GOLD's own act, never a business's,
 * which is why nothing here takes an organization argument at all. Recording which organization
 * that subaccount now belongs to is `lib/domain/providers/`'s job, once this has returned.
 *
 * Needs strictly less than placing a call does: no API key or application to hand a *browser*,
 * because provisioning creates those rather than using them. Only the master account and its
 * auth token, which is also all a deployment needs to have configured to record calls it placed
 * by hand — so a deployment that can log a call by hand but not yet dial one can still provision.
 */
export async function telephonyProvisioner(): Promise<TelephonyProvisioner | null> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!account || !token) return null;

  const { twilioProvisioner } = await import('./twilio');
  return twilioProvisioner({ account, token });
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

/**
 * The one place `platform_providers.key` and `organization_provider_resources.resource_type`
 * spell a carrier's name for this capability — so `lib/domain/providers/` can resolve *this
 * business's telephony scope* without importing the word itself. A domain file that
 * needs "the provider key this capability uses" asks this function; needing to know which
 * vendor that is remains this file's job alone.
 */
export function telephonyProviderKey(): string {
  return 'twilio';
}

/** The resource types this capability records, named once so a domain file never spells one. */
export const TELEPHONY_RESOURCE_TYPES = {
  subaccount: 'twilio_subaccount',
  apiKey: 'twilio_api_key',
  twimlApp: 'twilio_twiml_app',
  phoneNumber: 'twilio_phone_number',
} as const;

/**
 * Whether this deployment still holds GOLD's carrier account in its own environment — the
 * bootstrap path every binding used before a provider account could be recorded. Exposed as a
 * fact for the platform console; it reads no value out.
 */
export function telephonyBootstrapConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/**
 * What a business's subaccount is called at the carrier. One place, because reconciliation
 * recognises a scope GOLD made by this name and provisioning is what gave it.
 */
export function telephonySubaccountName(organizationId: string): string {
  return `gold-org-${organizationId}`;
}

const CREDENTIAL_KINDS: readonly TelephonyCredentialKind[] = [
  { key: 'api_key', label: 'API key (recommended)', identifierLabel: 'API key SID' },
  { key: 'auth_token', label: 'Account auth token', identifierLabel: null },
];

export function telephonyCredentialKinds(): readonly TelephonyCredentialKind[] {
  return CREDENTIAL_KINDS;
}

/**
 * The shape of an account's *public* facts, checked before anything is stored. A better error
 * message and never an authorization — the carrier's own answer at verification is the real check.
 */
export function validateTelephonyAccountIdentity(input: {
  accountId: string;
  credentialKind: string;
  credentialIdentifier: string | null;
}): string | null {
  if (!/^AC[0-9a-fA-F]{32}$/.test(input.accountId)) {
    return 'The Account SID starts with AC followed by 32 characters.';
  }
  const kind = CREDENTIAL_KINDS.find((candidate) => candidate.key === input.credentialKind);
  if (!kind) return 'Choose one of the supported credential types.';
  if (kind.identifierLabel === null) {
    return input.credentialIdentifier ? `${kind.label} takes no separate identifier.` : null;
  }
  if (!input.credentialIdentifier || !/^SK[0-9a-fA-F]{32}$/.test(input.credentialIdentifier)) {
    return `${kind.identifierLabel} starts with SK followed by 32 characters.`;
  }
  return null;
}

/**
 * GOLD's account as held in Vault, reached through `apps/api` with the caller's own token. The
 * token is forwarded and nothing is minted here: `apps/api` proves the caller is platform staff
 * before it reads a credential.
 */
export async function telephonyAccountOperations(input: {
  token: string;
  accountId: string;
}): Promise<TelephonyAccountOperations> {
  const { twilioAccountOperations } = await import('./twilio-accounts');
  return twilioAccountOperations(input);
}
