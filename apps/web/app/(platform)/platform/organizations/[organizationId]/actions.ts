'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { recordProviderResource, setProviderResourceStatus } from '@/lib/domain/providers/bindings';
import { provisionTelephonySubaccount } from '@/lib/domain/providers/twilio-provisioning';
import { TELEPHONY_RESOURCE_TYPES, telephonyProviderKey } from '@/lib/adapters/telephony';

export type ProvisionTwilioState = { error: string | null; provisioned: boolean };

export const PROVISION_TWILIO_INITIAL: ProvisionTwilioState = { error: null, provisioned: false };

export async function provisionTwilioAction(
  _previous: ProvisionTwilioState,
  formData: FormData,
): Promise<ProvisionTwilioState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await provisionTelephonySubaccount(db, { organizationId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, provisioned: false };
    throw error;
  }

  revalidatePath(`/platform/organizations/${organizationId}`);
  return { error: null, provisioned: true };
}

export type RegisterResourceState = { error: string | null; recorded: boolean };

export const REGISTER_RESOURCE_INITIAL: RegisterResourceState = { error: null, recorded: false };

export async function registerPhoneNumberAction(
  _previous: RegisterResourceState,
  formData: FormData,
): Promise<RegisterResourceState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await recordProviderResource(db, {
      organizationId,
      providerKey: telephonyProviderKey(),
      resourceType: TELEPHONY_RESOURCE_TYPES.phoneNumber,
      externalId: String(formData.get('number') ?? '').trim(),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }

  revalidatePath(`/platform/organizations/${organizationId}`);
  return { error: null, recorded: true };
}

export type SetResourceStatusState = { error: string | null; recorded: boolean };

export const SET_RESOURCE_STATUS_INITIAL: SetResourceStatusState = { error: null, recorded: false };

export async function setResourceStatusAction(
  _previous: SetResourceStatusState,
  formData: FormData,
): Promise<SetResourceStatusState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const status = String(formData.get('status') ?? '');

  try {
    if (status !== 'pending' && status !== 'active' && status !== 'failed' && status !== 'disabled') {
      throw new DomainError('Unknown resource status.', 'providers.status_invalid');
    }
    await setProviderResourceStatus(db, {
      organizationId,
      resourceId: String(formData.get('resourceId') ?? ''),
      status,
      error: String(formData.get('errorDetail') ?? '') || null,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }

  revalidatePath(`/platform/organizations/${organizationId}`);
  return { error: null, recorded: true };
}

export type RecordTermState = { error: string | null; recorded: boolean };

export const TERM_INITIAL: RecordTermState = { error: null, recorded: false };

export async function recordCommercialTermAction(
  _previous: RecordTermState,
  formData: FormData,
): Promise<RecordTermState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const priceMinor = Number(formData.get('priceMinor') ?? 0);
  const currency = String(formData.get('currency') ?? '').trim();

  try {
    await recordCommercialTerm(db, {
      organizationId,
      productKey: String(formData.get('productKey') ?? ''),
      periodStart: String(formData.get('periodStart') ?? ''),
      periodEnd: String(formData.get('periodEnd') ?? ''),
      priceMinor,
      currency: priceMinor === 0 && currency === '' ? undefined : currency,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }

  revalidatePath(`/platform/organizations/${organizationId}`);
  return { error: null, recorded: true };
}
