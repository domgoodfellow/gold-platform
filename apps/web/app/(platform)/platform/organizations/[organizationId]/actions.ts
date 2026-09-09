'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordProviderRate, recordRetailRate } from '@/lib/domain/commercial/catalogue';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';

export type RecordRateState = { error: string | null; recorded: boolean };

export const RATE_INITIAL: RecordRateState = { error: null, recorded: false };

async function recordRate(
  kind: 'provider' | 'retail',
  formData: FormData,
): Promise<RecordRateState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  const input = {
    meterId: String(formData.get('meterId') ?? ''),
    currency: String(formData.get('currency') ?? ''),
    unitAmountMicros: Number(formData.get('unitAmountMicros') ?? 0),
    source: String(formData.get('source') ?? ''),
    note: String(formData.get('note') ?? ''),
  };

  try {
    if (kind === 'provider') {
      await recordProviderRate(db, input);
    } else {
      await recordRetailRate(db, input);
    }
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }

  revalidatePath(`/platform/organizations/${organizationId}`);
  return { error: null, recorded: true };
}

export async function recordProviderRateAction(
  _previous: RecordRateState,
  formData: FormData,
): Promise<RecordRateState> {
  return recordRate('provider', formData);
}

export async function recordRetailRateAction(
  _previous: RecordRateState,
  formData: FormData,
): Promise<RecordRateState> {
  return recordRate('retail', formData);
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
