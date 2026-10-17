import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireAccessToken } from '@/lib/api/client';
import {
  TELEPHONY_RESOURCE_TYPES,
  callbackBase,
  telephonyAccountOperations,
  telephonyProviderKey,
  telephonyProvisioner,
  telephonySubaccountName,
} from '@/lib/adapters/telephony';
import { getDefaultProviderAccount, getProviderAccount, listProviderOrganizationStandings } from './accounts';
import {
  beginProviderBinding,
  listProviderResources,
  recordProviderResource,
  setProviderBindingStatus,
  storeProviderSecret,
} from './bindings';

/**
 * Standing up one organization's own scope inside this deployment's telephony capability — a
 * subaccount, a key and an application, in that order (the telephony-identity design, section 4).
 *
 * **The real lifecycle, in order, and idempotent at every step.** A retried call after a partial
 * failure does not recreate a subaccount, key or application that already exists — each step
 * first asks what this organization's binding already has, and only calls the capability for
 * what is still missing. That is what makes "provisioning failed, try again" safe to press
 * twice.
 *
 * **A failure is this binding's own `status` and `last_error`, never only a thrown error nobody
 * kept.** Every exit past `beginProviderBinding` that does not reach the end calls
 * `setProviderBindingStatus(..., 'failed', ...)` before this function's caller ever sees an
 * exception, so the platform console's next read of this organization already shows why.
 *
 * **Which vendor this is stays `lib/adapters/telephony/registry.ts`'s own subject.** This
 * file asks it for a provider key and a set of resource type names rather than spelling either.
 */
export async function provisionTelephonySubaccount(
  db: Db,
  input: { organizationId: string; providerAccountId?: string },
): Promise<{ subaccountSid: string; twimlAppSid: string }> {
  const { organizationId } = input;
  const providerKey = telephonyProviderKey();

  // **Whose account this binding lives under is decided once and then kept.** A binding that
  // already exists keeps the account it began under — a retry must never strand resources under
  // one account while pointing at another — and a bootstrap binding (no account) keeps using the
  // deployment's own credential. Only a first provisioning chooses: the account named, else the
  // provider's default, else the deployment bootstrap exactly as before accounts existed.
  const [standing] = await listProviderOrganizationStandings(db, { providerKey, organizationId });
  const accountId = standing?.bindingId
    ? standing.providerAccountId
    : (input.providerAccountId ?? (await getDefaultProviderAccount(db, providerKey))?.id ?? null);

  if (accountId) {
    const account = await getProviderAccount(db, accountId);
    if (!account || account.status !== 'active') {
      throw new DomainError('That provider account is not active.', 'providers.account_inactive');
    }
    if (account.verificationState !== 'verified') {
      throw new DomainError('Verify the provider account before provisioning under it.', 'providers.account_unverified');
    }
  }

  await beginProviderBinding(db, { organizationId, providerKey, providerAccountId: standing?.bindingId ? undefined : accountId ?? undefined });

  const provisioner = accountId
    ? (await telephonyAccountOperations({ token: await requireAccessToken(db), accountId })).provisioner
    : await telephonyProvisioner();
  const voiceUrl = callbackBase();

  if (!provisioner || !voiceUrl) {
    const error = !provisioner
      ? 'This deployment has no telephony master credential configured.'
      : 'This deployment has no telephony callback address configured.';
    await setProviderBindingStatus(db, { organizationId, providerKey, status: 'failed', error });
    throw new DomainError(error, 'providers.telephony_unconfigured');
  }

  try {
    const existing = await listProviderResources(db, { organizationId, providerKey });
    const friendlyName = telephonySubaccountName(organizationId);

    let subaccountSid = existing.find(
      (resource) => resource.resourceType === TELEPHONY_RESOURCE_TYPES.subaccount,
    )?.externalId;
    if (!subaccountSid) {
      const created = await provisioner.createSubaccount({ friendlyName });
      await recordProviderResource(db, {
        organizationId,
        providerKey,
        resourceType: TELEPHONY_RESOURCE_TYPES.subaccount,
        externalId: created.sid,
      });
      subaccountSid = created.sid;
    }

    // The subaccount id itself is what every later call in this deployment addresses —
    // recorded on the binding, not only on the resource, so `telephonyProvider` can resolve it
    // without a second table read.
    await setProviderBindingStatus(db, {
      organizationId,
      providerKey,
      status: 'provisioning',
      externalAccountId: subaccountSid,
    });

    const existingApiKey = existing.find(
      (resource) => resource.resourceType === TELEPHONY_RESOURCE_TYPES.apiKey,
    );
    if (!existingApiKey) {
      const created = await provisioner.createApiKey({ subaccountSid, friendlyName });
      const resourceId = await recordProviderResource(db, {
        organizationId,
        providerKey,
        resourceType: TELEPHONY_RESOURCE_TYPES.apiKey,
        externalId: created.sid,
      });
      // The carrier hands back the secret exactly once. Retained now, in Vault, or it is gone —
      // there is no second chance to ask for it again.
      await storeProviderSecret(db, { organizationId, resourceId, secret: created.secret });
    }

    let twimlAppSid = existing.find(
      (resource) => resource.resourceType === TELEPHONY_RESOURCE_TYPES.twimlApp,
    )?.externalId;
    if (!twimlAppSid) {
      const created = await provisioner.createTwimlApp({
        subaccountSid,
        friendlyName,
        voiceUrl: `${voiceUrl}/voice/outbound`,
      });
      await recordProviderResource(db, {
        organizationId,
        providerKey,
        resourceType: TELEPHONY_RESOURCE_TYPES.twimlApp,
        externalId: created.sid,
      });
      twimlAppSid = created.sid;
    }

    await setProviderBindingStatus(db, {
      organizationId,
      providerKey,
      status: 'active',
      externalAccountId: subaccountSid,
    });

    return { subaccountSid, twimlAppSid };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await setProviderBindingStatus(db, { organizationId, providerKey, status: 'failed', error: message });
    throw new DomainError(`Telephony provisioning failed: ${message}`, 'providers.telephony_provisioning_failed');
  }
}
