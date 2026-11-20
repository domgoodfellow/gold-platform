import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { organizationPlanPrice } from '@/lib/domain/catalogue/organization-plans';
import { getPlanById } from '@/lib/domain/catalogue/plans';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * Provisioning a business's negotiated plan price with GildOps' billing provider. A plan's standard
 * prices are provisioned from GildOps' Finance (`lib/domain/pricing/item-provider-prices.ts`,
 * ADR-057); only the provider call happens here, and only references are written.
 */
export type ProvisionedPlanPrice = {
  productReference: string;
  priceReference: string;
};

/**
 * Staff provisioning the processor's representation of one organization's negotiated price
 * (`organization_plan_agreements`) -- the agreement-priced counterpart to `provisionPlanPrice`.
 * Never mutates the Plan's own standard provider price; the mapping is its own table, keyed
 * by the `organization_plan_agreements` row that produced the amount -- so a later agreement is
 * provisioned as its own provider price and the earlier one's mapping stays as it was.
 */
export async function provisionAgreementPlanPrice(
  db: Db,
  input: { organizationId: string; planId: string; billingInterval: 'month' | 'year' | 'one_time' },
): Promise<ProvisionedPlanPrice> {
  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError('Billing isn’t set up for GildOps yet.', 'platform_billing.not_configured');
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

  // The mapping belongs to this exact agreement record, so a later agreement for the same Plan
  // gets a provider price of its own and this one's is never touched.
  const agreementId = price.sourceId;

  // Staff holds select on this table directly (its RLS, not the tenant-gated reference RPC
  // checkout itself calls) -- the idempotency check below is a staff-side read of what staff
  // already provisioned, never a `billing.manage` question.
  const { data: existing, error: readError } = await db
    .from('organization_plan_agreement_provider_prices')
    .select('product_reference, price_reference')
    .eq('organization_id', input.organizationId)
    .eq('agreement_id', agreementId)
    .eq('environment', provider.environment)
    .eq('billing_interval', input.billingInterval)
    .maybeSingle();
  if (readError) throw fromDatabaseError(readError, 'platform_billing.agreement_price_lookup_failed');
  if (existing) {
    return { productReference: existing.product_reference, priceReference: existing.price_reference };
  }

  const { productId, priceId } = await provider.createPrice({
    productIdempotencyKey: `platform-agreement-product:${agreementId}`,
    priceIdempotencyKey: `platform-agreement-price:${agreementId}:${input.billingInterval}`,
    planKey: plan.key,
    planLabel: plan.label,
    currency: price.currency,
    amountMinor: price.amountMinor,
    billingInterval: input.billingInterval,
  });

  const { error } = await db.rpc('record_agreement_provider_price', {
    p_agreement_id: agreementId,
    p_environment: provider.environment,
    p_billing_interval: input.billingInterval,
    p_product_reference: productId,
    p_price_reference: priceId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff can provision billing prices.', 'platform_billing.forbidden');
    }
    throw fromDatabaseError(error, 'platform_billing.provision_failed');
  }

  return { productReference: productId, priceReference: priceId };
}
