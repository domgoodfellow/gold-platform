import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import type { PublicPlan } from '@/lib/domain/catalogue/public-catalog';

export type SelfServeInterval = 'month' | 'year';

/** The list price a listed plan is sold at in one currency and interval, or null when it is not. */
export function selfServePrice(plan: Pick<PublicPlan, 'prices'>, currency: string | null | undefined, interval: SelfServeInterval) {
  if (!currency) return null;
  return plan.prices.find((price) => price.currency === currency && price.billingInterval === interval) ?? null;
}

/** The currencies a plan is sold in for an interval, for saying which to choose when it is not the business's. */
export function selfServeCurrencies(plan: Pick<PublicPlan, 'prices'>, interval: SelfServeInterval): string[] {
  return [...new Set(plan.prices.filter((price) => price.billingInterval === interval).map((price) => price.currency))];
}

/**
 * Puts a business its billing manager just founded on the plan they chose. The database checks
 * the plan is listed and priced in the business's currency, records the business as a GildOps
 * customer and writes the subscription in GildOps' Finance, which switches the plan on.
 * Returns the subscription.
 */
export async function choosePlatformPlan(
  db: Db,
  input: { organizationId: string; planKey: string; billingInterval: SelfServeInterval },
): Promise<string> {
  const { data, error } = await db.rpc('choose_platform_plan', {
    p_organization_id: input.organizationId,
    p_plan_key: input.planKey,
    p_billing_interval: input.billingInterval,
  });
  if (error) throw fromDatabaseError(error, 'platform_billing.choose_failed');
  if (typeof data !== 'string') throw new DomainError('That plan could not be chosen.', 'platform_billing.choose_failed');
  return data;
}
