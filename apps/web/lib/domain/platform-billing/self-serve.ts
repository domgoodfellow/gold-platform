import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * Puts a business its billing manager just founded on the plan they chose on Pricing, billed
 * monthly: checkout charges monthly. The database checks the plan is listed and has a monthly list
 * price, in the business's currency when GildOps sells it in that one and otherwise in the plan's
 * own; records the business as a GildOps customer; and writes the subscription in GildOps'
 * Finance, which switches the plan on. Returns the subscription.
 */
export async function choosePlatformPlan(db: Db, input: { organizationId: string; planKey: string }): Promise<string> {
  const { data, error } = await db.rpc('choose_platform_plan', {
    p_organization_id: input.organizationId,
    p_plan_key: input.planKey,
    p_billing_interval: 'month',
  });
  if (error) throw fromDatabaseError(error, 'platform_billing.choose_failed');
  if (typeof data !== 'string') throw new DomainError('That plan could not be chosen.', 'platform_billing.choose_failed');
  return data;
}
