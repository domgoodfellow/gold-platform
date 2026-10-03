import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { organizationPlanPrice } from '@/lib/domain/catalogue/organization-plans';
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

export type ProvisionedPlanPriceRow = ProvisionedPlanPrice & { planPriceId: string };

function toProvisioned(row: { product_reference: string; price_reference: string }): ProvisionedPlanPrice {
  return { productReference: row.product_reference, priceReference: row.price_reference };
}

/** One bounded read for a known set of prices. RLS remains the authority for row visibility. */
export async function listProvisionedPlanPrices(
  db: Db,
  input: { planPriceIds: string[]; environment: 'sandbox' | 'live' },
): Promise<ProvisionedPlanPriceRow[]> {
  if (input.planPriceIds.length === 0) return [];
  const { data, error } = await db
    .from('platform_plan_provider_prices')
    .select('plan_price_id, product_reference, price_reference')
    .in('plan_price_id', input.planPriceIds)
    .eq('environment', input.environment);
  if (error) throw new DomainError(error.message, 'platform_billing.provisioned_prices_read_failed');
  return (data ?? []).map((row) => ({
    planPriceId: row.plan_price_id,
    productReference: row.product_reference,
    priceReference: row.price_reference,
  }));
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

/**
 * Staff provisioning the processor's representation of one organization's negotiated price
 * (`organization_plan_agreements`) -- the agreement-priced counterpart to `provisionPlanPrice`.
 * Never mutates the Plan's own standard provider price (I8); the mapping is its own table, keyed
 * by organization rather than by a `platform_plan_prices` row that does not exist for this price.
 */
export async function provisionAgreementPlanPrice(
  db: Db,
  input: { organizationId: string; planId: string; billingInterval: 'month' | 'year' | 'one_time' },
): Promise<ProvisionedPlanPrice> {
  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError('Billing is not configured for this deployment.', 'platform_billing.not_configured');
  }

  const plan = await getPlanById(db, input.planId);
  if (!plan) throw new DomainError('No such Plan.', 'platform_billing.plan_not_found');

  const price = await organizationPlanPrice(db, {
    organizationId: input.organizationId,
    planId: input.planId,
    billingInterval: input.billingInterval,
  });
  if (!price || price.source !== 'agreement') {
    throw new DomainError(
      'This organization has no negotiated agreement price for that Plan.',
      'platform_billing.agreement_not_found',
    );
  }

  // Staff holds select on this table directly (its RLS, not the tenant-gated reference RPC
  // checkout itself calls) -- the idempotency check below is a staff-side read of what staff
  // already provisioned, never a `billing.manage` question.
  const { data: existing, error: readError } = await db
    .from('organization_plan_agreement_provider_prices')
    .select('product_reference, price_reference')
    .eq('organization_id', input.organizationId)
    .eq('plan_id', input.planId)
    .eq('environment', provider.environment)
    .eq('billing_interval', input.billingInterval)
    .maybeSingle();
  if (readError) throw new DomainError(readError.message, 'platform_billing.agreement_price_lookup_failed');
  if (existing) {
    return { productReference: existing.product_reference, priceReference: existing.price_reference };
  }

  const { productId, priceId } = await provider.createPrice({
    productIdempotencyKey: `platform-agreement-product:${input.organizationId}:${plan.key}`,
    priceIdempotencyKey: `platform-agreement-price:${input.organizationId}:${plan.key}:${input.billingInterval}`,
    planKey: plan.key,
    planLabel: plan.label,
    currency: price.currency,
    amountMinor: price.amountMinor,
    billingInterval: input.billingInterval,
  });

  const { error } = await db.rpc('record_agreement_provider_price', {
    p_organization_id: input.organizationId,
    p_plan_id: input.planId,
    p_environment: provider.environment,
    p_billing_interval: input.billingInterval,
    p_product_reference: productId,
    p_price_reference: priceId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff can provision billing prices.', 'platform_billing.forbidden');
    }
    throw new DomainError(error.message, 'platform_billing.provision_failed');
  }

  return { productReference: productId, priceReference: priceId };
}
