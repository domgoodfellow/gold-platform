import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
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

/** This organization's billing customer in one provider environment — never another environment's. */
export async function getPlatformBillingCustomer(
  db: Db,
  input: { organizationId: string; environment: PlatformBillingCustomer['environment'] },
): Promise<PlatformBillingCustomer | null> {
  const { data, error } = await db
    .from('platform_billing_customers')
    .select('organization_id, environment, customer_reference')
    .eq('organization_id', input.organizationId)
    .eq('environment', input.environment)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'platform_billing.customer_read_failed');
  return data ? toCustomer(data) : null;
}

const API_REFUSALS: Readonly<Record<string, [string, string]>> = {
  'api.not_found': ['Only this business’s own billing manager can start a subscription.', 'platform_billing.forbidden'],
  'api.provider_refused': ['The billing provider would not create a customer.', 'platform_billing.provider_refused'],
  'api.conflict': ['This business’s billing customer changed while it was being set up. Try again.', 'platform_billing.customer_conflict'],
};

/**
 * Provision this organization's Stripe Customer if it does not already have one for this
 * deployment's environment, and return it either way.
 *
 * **Never recorded from here.** Which processor customer an organization owns may only be written
 * by `apps/api`'s billing provisioner, from a reference the processor returned to it under GOLD's
 * own key (`/platform-billing/customer`). This forwards the person's own token, so the database
 * decides — as that person — whether they may manage this business's billing before the processor
 * is ever asked, and nothing a browser or this runtime supplies can name a customer reference.
 *
 * Idempotency, retries and concurrent first requests are the API's and the database's: one
 * reservation per organization and environment, one processor request per reservation, and a
 * request that loses a race returns the winner's customer.
 */
export async function ensurePlatformBillingCustomer(
  db: Db,
  input: { organizationId: string; email: string | null; name: string },
): Promise<PlatformBillingCustomer> {
  await requireActor(db);

  const provider = await platformBillingProvider();
  if (!provider) {
    throw new DomainError(
      'Billing is not configured for this deployment.',
      'platform_billing.not_configured',
    );
  }

  let result: { customer_reference: string; environment: string };
  try {
    result = await callDomainCommand('/platform-billing/customer', {
      token: await requireAccessToken(db),
      body: { organization_id: input.organizationId, email: input.email, name: input.name },
    });
  } catch (error) {
    const known = error instanceof DomainError ? API_REFUSALS[error.code] : undefined;
    if (known) throw new DomainError(known[0], known[1]);
    throw error;
  }

  // Both runtimes read the environment from GOLD's own key. If they disagree, the two keys are not
  // the same account mode, and a checkout must not proceed against the wrong customer.
  if (result.environment !== provider.environment) {
    throw new DomainError(
      'Billing is configured differently in this deployment’s two runtimes.',
      'platform_billing.environment_mismatch',
    );
  }
  return { organizationId: input.organizationId, environment: provider.environment, customerReference: result.customer_reference };
}
