import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { PurchaseQuoteLine } from '@/lib/domain/platform-billing/quote';

export type CheckoutLineItem = { priceReference: string; quantity: number };

/**
 * Resolves every quote line to the provider's own price reference -- a standard Plan/Add-on
 * price through `plan_price_provider_reference`, an organization-specific negotiated price
 * through its own mapping (work order C §9). Provider vocabulary never leaves this function:
 * callers get back an opaque reference, never a Stripe id they could otherwise be tempted to
 * build themselves.
 */
export async function resolveCheckoutLineItems(
  db: Db,
  input: { organizationId: string; environment: string; lines: readonly PurchaseQuoteLine[] },
): Promise<CheckoutLineItem[]> {
  const items: CheckoutLineItem[] = [];

  for (const line of input.lines) {
    let reference: string | null;

    if (line.priceSourceDomain === 'catalogue.plan_agreement') {
      const { data, error } = await db.rpc('organization_plan_agreement_provider_price_reference', {
        p_organization_id: input.organizationId,
        p_agreement_id: line.priceSourceId,
        p_environment: input.environment,
        p_billing_interval: line.billingInterval,
      });
      if (error) throw new DomainError(error.message, 'platform_billing.agreement_price_lookup_failed');
      reference = data;
    } else {
      const { data, error } = await db.rpc('plan_price_provider_reference', {
        p_organization_id: input.organizationId,
        p_plan_price_id: line.priceSourceId,
        p_environment: input.environment,
      });
      if (error) throw new DomainError(error.message, 'platform_billing.price_lookup_failed');
      reference = data;
    }

    if (!reference) {
      throw new DomainError(
        `${line.label} has not been provisioned with the billing provider yet — ask platform staff to provision this price.`,
        'platform_billing.price_not_provisioned',
      );
    }

    items.push({ priceReference: reference, quantity: line.quantity });
  }

  return items;
}
