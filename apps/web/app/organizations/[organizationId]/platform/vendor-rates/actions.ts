'use server';

import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordProviderCostRate } from '@/lib/domain/commercial/catalogue';
import { revalidatePlatform } from '@/lib/route/platform';

export type VendorRateState = { error: string | null; recorded: boolean };
export const VENDOR_RATE_INITIAL: VendorRateState = { error: null, recorded: false };

const value = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();

export async function recordVendorRateAction(
  _: VendorRateState,
  formData: FormData,
): Promise<VendorRateState> {
  try {
    const direction = value(formData, 'direction');
    await recordProviderCostRate(await getDb(), {
      providerKey: value(formData, 'providerKey'),
      commercialMeterId: value(formData, 'commercialMeterId'),
      costMeterKey: value(formData, 'costMeterKey'),
      currency: value(formData, 'currency').toUpperCase(),
      unitAmountMicros: Number(formData.get('unitAmountMicros')),
      effectiveFrom: new Date(value(formData, 'effectiveFrom')).toISOString(),
      source: value(formData, 'source'),
      region: value(formData, 'region') || undefined,
      direction: direction === 'inbound' || direction === 'outbound' ? direction : undefined,
      resourceType: value(formData, 'resourceType') || undefined,
      note: value(formData, 'note'),
    });
  } catch (error) {
    if (error instanceof DomainError || error instanceof RangeError) {
      return { error: error.message, recorded: false };
    }
    throw error;
  }
  revalidatePlatform();
  return { error: null, recorded: true };
}
