import type { OrganizationSubscriptionItem } from '@/lib/domain/platform-billing/subscriptions';

/**
 * What the provider is currently billing, in the business's own words — never a provider id.
 *
 * Only an item that maps to a canonical Plan or Add-on is named. An item GildOps cannot map is
 * counted and reported as needing review, because a raw provider price id is a staff diagnostic and
 * not a label for a customer. This is a reading of the provider's items: it neither grants nor
 * assigns anything.
 */
export type SubscriptionPackage = {
  basePlanLabel: string | null;
  addons: { label: string; quantity: number | null }[];
  /** Active provider items GildOps could not map to a Plan or Add-on, or whose base Plan could not be told apart. */
  itemsNeedingReview: number;
};

export function describeSubscriptionPackage(
  items: readonly OrganizationSubscriptionItem[],
  plans: readonly { id: string; label: string; kind: string }[],
): SubscriptionPackage {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const active = items.filter((item) => item.active);

  let basePlanLabel: string | null = null;
  let baseCount = 0;
  const addons: SubscriptionPackage['addons'] = [];
  let itemsNeedingReview = 0;

  for (const item of active) {
    const plan = item.canonicalSource?.planId ? planById.get(item.canonicalSource.planId) : undefined;
    if (!plan) {
      itemsNeedingReview += 1;
    } else if (plan.kind === 'plan') {
      baseCount += 1;
      basePlanLabel = baseCount === 1 ? plan.label : null;
    } else {
      addons.push({ label: plan.label, quantity: item.quantity });
    }
  }

  // Two items that both claim to be the base Plan cannot be told apart, so neither is named as it.
  if (baseCount > 1) itemsNeedingReview += baseCount;

  addons.sort((a, b) => a.label.localeCompare(b.label));
  return { basePlanLabel, addons, itemsNeedingReview };
}
