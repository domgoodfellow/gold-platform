'use server';

import { revalidateFinance } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { provisionPlanPrice } from '@/lib/domain/platform-billing/provisioning';

export type ProvisionPriceState = { error: string | null; provisioned: boolean };

export async function provisionPlanPriceAction(
  _: ProvisionPriceState,
  formData: FormData,
): Promise<ProvisionPriceState> {
  try {
    await provisionPlanPrice(await getDb(), {
      planId: String(formData.get('planId') ?? ''),
      planPriceId: String(formData.get('planPriceId') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, provisioned: false };
    throw error;
  }
  revalidateFinance();
  return { error: null, provisioned: true };
}
