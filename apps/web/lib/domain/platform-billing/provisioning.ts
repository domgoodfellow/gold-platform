import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { getPlanById, listPlanPrices } from '@/lib/domain/catalogue/plans';
import { DomainError } from '@/lib/domain/errors';

/**
 * Staff provisioning a Plan's recorded price with the billing provider (Phase 4: GOLD
 * provisions Products/Prices via the provider's API, never a price invented while a caller
 * waits at checkout). The provider call happens here, in TypeScript (D2); only the resulting
 * references are ever written to the database, by `record_plan_provider_price`.
 */
export type ProvisionedPlanPrice = {
  productReference: string;
  priceReference: string;
};

function toProvisioned(row: { product_reference: string; price_reference: string }): ProvisionedPlanPrice {
  return { productReference: row.product_reference, priceReference: row.price_reference };
}

export async function getProvisionedPlanPrice(
  db: Db,
  input: { planPriceId: string; environment: 'sandbox' | 'live' },
): Promise<ProvisionedPlanPrice | null> {
  const { data, error } = await db
    .from('platform_plan_provider_prices')
    .select('product_reference, price_reference')
    .eq('plan_price_id', input.planPriceId)
    .eq('environment', input.environment)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'platform_billing.provisioned_price_read_failed');
  return data ? toProvisioned(data) : null;
}

export async function provisionPlanPrice(
  db: Db,
  input: { planId: string; planPriceId: string },
): Promise<ProvisionedPlanPrice> {
  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError('Billing is not configured for this deployment.', 'platform_billing.not_configured');
  }

  const plan = await getPlanById(db, input.planId);
  if (!plan) throw new DomainError('No such Plan.', 'platform_billing.plan_not_found');

  const prices = await listPlanPrices(db, input.planId);
  const price = prices.find((p) => p.id === input.planPriceId);
  if (!price) throw new DomainError('No such price on that Plan.', 'platform_billing.price_not_found');

  const existing = await getProvisionedPlanPrice(db, {
    planPriceId: price.id,
    environment: provider.environment,
  });
  if (existing) return existing;

  const { productId, priceId } = await provider.createPrice({
    productIdempotencyKey: `platform-plan-product:${plan.key}`,
    priceIdempotencyKey: `platform-plan-price:${price.id}`,
    planKey: plan.key,
    planLabel: plan.label,
    currency: price.currency,
    amountMinor: price.amountMinor,
    billingInterval: price.billingInterval,
  });

  const { error } = await db.rpc('record_plan_provider_price', {
    p_plan_price_id: price.id,
    p_environment: provider.environment,
    p_product_reference: productId,
    p_price_reference: priceId,
    p_provider: provider.name,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff can provision billing prices.', 'platform_billing.forbidden');
    }
    throw new DomainError(error.message, 'platform_billing.provision_failed');
  }

  return { productReference: productId, priceReference: priceId };
}
