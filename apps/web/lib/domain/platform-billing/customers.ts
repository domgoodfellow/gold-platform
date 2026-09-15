import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The organization's own Stripe Customer on GOLD's Stripe account — see
 * `platform_billing_customers`' own migration comment for why this is never joined to, or
 * confused with, `payment_accounts` (a tenant's connected `acct_...`, the opposite money
 * direction).
 */
export type PlatformBillingCustomer = {
  organizationId: string;
  environment: 'sandbox' | 'live';
  customerReference: string;
};

/** Written by `ensurePlatformBillingCustomer` before the provider answers — never a real reference. */
const PENDING_PREFIX = 'pending:';

function toCustomer(row: {
  organization_id: string;
  environment: string;
  customer_reference: string;
}): PlatformBillingCustomer {
  return {
    organizationId: row.organization_id,
    environment: row.environment as 'sandbox' | 'live',
    customerReference: row.customer_reference,
  };
}

export async function getPlatformBillingCustomer(
  db: Db,
  input: { organizationId: string },
): Promise<PlatformBillingCustomer | null> {
  const { data, error } = await db
    .from('platform_billing_customers')
    .select('organization_id, environment, customer_reference')
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'platform_billing.customer_read_failed');
  return data ? toCustomer(data) : null;
}

/**
 * Provision this organization's Stripe Customer if it does not already have one for this
 * deployment's environment, and return it either way.
 *
 * **Ask, then correct — the same order `payment_requests` uses for a one-off request (I6),
 * applied to provisioning.** A placeholder row is written first, under the caller's own
 * `billing.manage`-gated insert; the provider is asked only once that succeeds, and the row is
 * then corrected with its real reference. Calling the provider before proving authorization
 * would let anyone who can merely read this table (any organization member) trigger a live
 * provider call before ever being checked — the earlier draft of this function did exactly that.
 *
 * **Idempotent in two layers.** The provider's own `Idempotency-Key` covers a network retry of
 * the exact call; the unique `(organization_id, environment)` row this function inserts is what
 * makes a second caller — including a genuine double-click, since the capability check and the
 * write are the same RLS-gated statement — a no-op that returns the row the first caller's
 * insert already won, rather than a second Stripe Customer.
 */
export async function ensurePlatformBillingCustomer(
  db: Db,
  input: { organizationId: string; email: string | null; name: string },
): Promise<PlatformBillingCustomer> {
  const actor = await requireActor(db);

  const existing = await getPlatformBillingCustomer(db, { organizationId: input.organizationId });
  if (existing && !existing.customerReference.startsWith(PENDING_PREFIX)) return existing;

  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError(
      'Billing is not configured for this deployment.',
      'platform_billing.not_configured',
    );
  }

  if (!existing) {
    const placeholder = `${PENDING_PREFIX}${crypto.randomUUID()}`;
    const { error: insertError } = await db.from('platform_billing_customers').insert({
      organization_id: input.organizationId,
      environment: provider.environment,
      provider: provider.name,
      customer_reference: placeholder,
      created_by: actor.id,
    });

    if (insertError) {
      if (insertError.code === '42501') {
        throw new DomainError(
          'Only this business’s own billing manager can start a subscription.',
          'platform_billing.forbidden',
        );
      }
      if (insertError.code === '23505') {
        // Lost the race to a concurrent first-time provision (I6) — the row it wrote is the
        // answer, unless that row is itself still pending, in which case falling through to
        // retry the provider call below is exactly right rather than returning a fake reference.
        const winner = await getPlatformBillingCustomer(db, { organizationId: input.organizationId });
        if (winner && !winner.customerReference.startsWith(PENDING_PREFIX)) return winner;
      } else {
        throw new DomainError(insertError.message, 'platform_billing.customer_provision_failed');
      }
    }
  }
  // else: a placeholder from an earlier attempt whose provider call failed — reuse the same row
  // rather than inserting a second one, which the unique (organization_id, environment)
  // constraint would refuse in any case.

  let customerId: string;
  try {
    ({ customerId } = await provider.ensureCustomer({
      organizationId: input.organizationId,
      email: input.email,
      name: input.name,
    }));
  } catch {
    // Deliberately not deleted — the row records that this business asked and the attempt
    // failed, the same reasoning card-payments.ts gives for a failed payment request.
    throw new DomainError('The billing provider would not create a customer.', 'platform_billing.provider_refused');
  }

  const { data: corrected, error: updateError } = await db
    .from('platform_billing_customers')
    .update({ customer_reference: customerId })
    .eq('organization_id', input.organizationId)
    .eq('environment', provider.environment)
    .select('organization_id, environment, customer_reference')
    .single();
  if (updateError) throw new DomainError(updateError.message, 'platform_billing.customer_correction_failed');

  return toCustomer(corrected);
}
