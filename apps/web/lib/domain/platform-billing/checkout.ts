import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { getPlan, listPlanPrices } from '@/lib/domain/catalogue/plans';
import { DomainError } from '@/lib/domain/errors';
import { ensurePlatformBillingCustomer } from '@/lib/domain/platform-billing/customers';
import { getOrganizationSubscription } from '@/lib/domain/platform-billing/subscriptions';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Starting a GOLD subscription. Every consequential value is resolved server-side from a Plan
 * key and the caller's own organization — never a Stripe price id or a customer id the browser
 * supplies (Phase 7, Phase 15).
 */
export async function beginPlatformBillingCheckout(
  db: Db,
  input: {
    organizationId: string;
    planKey: string;
    organizationName: string;
    organizationEmail: string | null;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ url: string }> {
  const actor = await requireActor(db);

  const plan = await getPlan(db, input.planKey);
  if (!plan || plan.kind !== 'plan' || plan.saleStatus !== 'active' || !plan.billable) {
    throw new DomainError('That Plan is not available to subscribe to.', 'platform_billing.plan_unavailable');
  }

  const prices = await listPlanPrices(db, plan.id);
  const price = prices.find((p) => p.approvalState === 'approved' && p.currency === input.currency);
  if (!price) {
    throw new DomainError(
      `GildOps has not priced ${plan.label} in ${input.currency}.`,
      'platform_billing.no_price_for_currency',
    );
  }

  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError('Billing is not configured for this deployment.', 'platform_billing.not_configured');
  }

  const { data: priceReference, error: mappingError } = await db.rpc('plan_price_provider_reference', {
    p_organization_id: input.organizationId,
    p_plan_price_id: price.id,
    p_environment: provider.environment,
  });
  if (mappingError) {
    if (mappingError.code === '42501') {
      throw new DomainError(
        'Only this business’s own billing manager can start a subscription.',
        'platform_billing.forbidden',
      );
    }
    throw new DomainError(mappingError.message, 'platform_billing.price_lookup_failed');
  }
  if (!priceReference) {
    throw new DomainError(
      `${plan.label} has not been provisioned with the billing provider yet — ask platform staff to provision this price.`,
      'platform_billing.price_not_provisioned',
    );
  }

  const existing = await getOrganizationSubscription(db, { organizationId: input.organizationId });
  if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) {
    throw new DomainError(
      'This business already has a subscription — manage it from the billing portal instead.',
      'platform_billing.already_subscribed',
    );
  }

  const customer = await ensurePlatformBillingCustomer(db, {
    organizationId: input.organizationId,
    email: input.organizationEmail,
    name: input.organizationName,
  });

  // Our own row first, so the correlation token — and the RLS check that this caller holds
  // `billing.manage` — exists before the provider is asked for anything (the same "ask, then
  // correct" shape `payment_requests` uses for tenant commerce).
  const { data: session, error: sessionError } = await db
    .from('platform_billing_checkout_sessions')
    .insert({
      organization_id: input.organizationId,
      environment: provider.environment,
      plan_price_id: price.id,
      requested_by: actor.id,
    })
    .select('id')
    .single();

  if (sessionError) {
    if (sessionError.code === '42501') {
      throw new DomainError(
        'Only this business’s own billing manager can start a subscription.',
        'platform_billing.forbidden',
      );
    }
    throw new DomainError(sessionError.message, 'platform_billing.session_failed');
  }

  let started;
  try {
    started = await provider.createCheckoutSession({
      customerId: customer.customerReference,
      priceId: priceReference,
      requestId: session.id,
      organizationId: input.organizationId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
  } catch {
    // Deliberately not deleted, the same reasoning card-payments.ts gives: the row records that
    // this business asked and the attempt failed, which is truer history than a gap.
    throw new DomainError('The billing provider would not start that checkout.', 'platform_billing.provider_refused');
  }

  const { error: updateError } = await db
    .from('platform_billing_checkout_sessions')
    .update({ provider_reference: started.providerReference })
    .eq('id', session.id);
  if (updateError) throw new DomainError(updateError.message, 'platform_billing.session_update_failed');

  return { url: started.url };
}
