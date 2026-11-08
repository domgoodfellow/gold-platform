import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { getPlan } from '@/lib/domain/catalogue/plans';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { ensurePlatformBillingCustomer } from '@/lib/domain/platform-billing/customers';
import { resolveCheckoutLineItems } from '@/lib/domain/platform-billing/line-items';
import { assertQuoteMatchesReview, buildOrganizationPurchaseQuote } from '@/lib/domain/platform-billing/quote';
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
    /** The `reviewVersion` of the quote the billing manager was shown -- the only thing about the
     * purchase the browser sends back. Every amount is rebuilt here. */
    reviewedQuoteVersion: string;
    organizationName: string;
    organizationEmail: string | null;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ url: string }> {
  const actor = await requireActor(db);

  const plan = await getPlan(db, input.planKey);
  // `unlisted` is sellable privately -- hidden from the ordinary catalogue and assigned by staff --
  // so an assigned one may be bought. Only `archived` is closed to new purchases.
  if (!plan || plan.kind !== 'plan' || plan.saleStatus === 'archived' || !plan.billable) {
    throw new DomainError('That Plan is not available to subscribe to.', 'platform_billing.plan_unavailable');
  }

  // Checkout purchases the organization's already-approved package -- it is never a catalogue
  // browse (work order C §3). Which Plan a business may subscribe to stays a staff-assigned
  // entitlement fact, enforced here rather than only in the one Plan the settings screen offers.
  const assignment = await currentPlanAssignment(db, { organizationId: input.organizationId });
  if (!assignment || assignment.planId !== plan.id) {
    throw new DomainError(
      'This is not the Plan currently assigned to this business.',
      'platform_billing.plan_not_assigned',
    );
  }

  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError('Billing isn’t set up for GildOps yet.', 'platform_billing.not_configured');
  }

  const existing = await getOrganizationSubscription(db, { organizationId: input.organizationId });
  if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) {
    throw new DomainError(
      'This business already has a subscription — manage it from the billing portal instead.',
      'platform_billing.already_subscribed',
    );
  }

  // Rebuilt here, never trusted from the browser, and compared with what the billing manager
  // actually reviewed before anything external happens -- no customer, no session row, no
  // provider call for a package that changed underneath them.
  const quote = await buildOrganizationPurchaseQuote(db, { organizationId: input.organizationId });
  assertQuoteMatchesReview(input.reviewedQuoteVersion, quote);
  if (quote.blockers.length > 0) {
    throw new DomainError(quote.blockers[0]!.message, `platform_billing.${quote.blockers[0]!.code}`);
  }
  if (quote.currency !== input.currency) {
    throw new DomainError(
      `GildOps has not priced ${plan.label} in ${input.currency}.`,
      'platform_billing.no_price_for_currency',
    );
  }

  const quoteLines = [...quote.recurring, ...quote.dueNow];
  const resolvedLines = await resolveCheckoutLineItems(db, {
    organizationId: input.organizationId,
    environment: provider.environment,
    lines: quoteLines,
  });
  const lineItems = resolvedLines.map((line) => ({ priceId: line.priceReference, quantity: line.quantity }));

  const baseLine = quote.recurring.find((line) => line.sourceType === 'plan' && line.sourceId === plan.id);

  // From here the snapshot is historical purchase intent. What the provider is asked to charge,
  // and the provider price each line resolved to, are written down now; a later webhook reconciles
  // to this row and never to a package recalculated after the fact.
  const quoteSnapshot = {
    ...quote,
    providerLines: resolvedLines.map((line, index) => ({
      priceSourceDomain: quoteLines[index]!.priceSourceDomain,
      priceSourceId: quoteLines[index]!.priceSourceId,
      providerPriceReference: line.priceReference,
      quantity: line.quantity,
    })),
  };

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
      plan_price_id: baseLine?.priceSourceDomain === 'catalogue.plan_price' ? baseLine.priceSourceId : null,
      requested_by: actor.id,
      quote_snapshot: quoteSnapshot,
      quote_version: quote.reviewVersion,
      expires_at: quote.expiresAt,
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
    throw fromDatabaseError(sessionError, 'platform_billing.session_failed');
  }

  let started;
  try {
    started = await provider.createCheckoutSession({
      customerId: customer.customerReference,
      lineItems,
      requestId: session.id,
      organizationId: input.organizationId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
  } catch {
    // Deliberately not deleted, the same reasoning card-payments.ts gives: the row records that
    // this business asked and the attempt failed, which is truer history than a gap.
    throw new DomainError('The billing service would not start that checkout.', 'platform_billing.provider_refused');
  }

  const { error: updateError } = await db
    .from('platform_billing_checkout_sessions')
    .update({ provider_reference: started.providerReference })
    .eq('id', session.id);
  if (updateError) throw fromDatabaseError(updateError, 'platform_billing.session_update_failed');

  return { url: started.url };
}
