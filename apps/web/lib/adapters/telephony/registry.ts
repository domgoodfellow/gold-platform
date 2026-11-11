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
 * **A business's calls happen in that business's own calling account.** The provider is built for
 * one person working in one business: their token and that business's id. It holds no credential;
 * `apps/api` reads the business's own key and reaches the carrier. There is no deployment-wide
 * carrier credential for calls, so no business can place a call in another's account, and none
 * shares one.
 *
 * `null` when this deployment has no `apps/api` to ask, rather than a throw. A business that
 * dials from mobile phones and writes down what happened is a complete business: the call is
 * recorded by hand, and the button that would have dialled says why it cannot. Whether a given
 * business has a calling account at all is the domain's question (`actingTelephonyAccount`).
 */
export async function telephonyProvider(input: {
  token: string;
  organizationId: string;
}): Promise<TelephonyProvider | null> {
  if (!process.env.GOLD_API_URL) return null;

  const { twilioTelephony } = await import('./twilio');
  return twilioTelephony(input);
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
 * The public base of this repository's own `apps/api` deployment, as the carrier reaches it.
 *
 * Read here for one purpose: provisioning points a new calling account's application at it. A
 * call's own reports are addressed by `apps/api` itself, never from this value.
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
