import type { ReconciliationIssue, SubscriptionReconciliationState } from '@/lib/domain/platform-billing/subscriptions';

/** One plain sentence per reconciliation state, for staff. */
export const RECONCILIATION_STATE_LABEL: Readonly<Record<SubscriptionReconciliationState, string>> = {
  matched: 'Matched',
  mismatch: 'Mismatch',
  legacy_unlinked: 'Legacy · no checkout',
  ambiguous: 'Ambiguous',
};

/**
 * What a recorded reconciliation finding means, for the staff who must repair it. The codes are the
 * database's; this is their only translation, so the screen never invents a second wording.
 */
export function describeReconciliationIssue(issue: ReconciliationIssue): string {
  const price = issue.priceReference ?? 'unknown price';
  switch (issue.code) {
    case 'missing_recurring_price':
      return `The checkout reviewed ${price} but the provider has no such recurring item.`;
    case 'unexpected_recurring_price':
      return `The provider bills ${price}, which the checkout did not review.`;
    case 'quantity_mismatch':
      return `${price}: the checkout reviewed quantity ${issue.expectedQuantity ?? '—'}, the provider has ${issue.actualQuantity ?? '—'}.`;
    case 'unmapped_provider_price':
      return `${price} is not mapped to any GildOps Plan or Add-on price.`;
    case 'base_plan_item_unidentified':
      return 'No provider item maps to a base Plan, so the billing period has no base Plan anchor.';
    case 'multiple_base_plan_items':
      return 'More than one provider item maps to a base Plan.';
    case 'replaced_live_subscription':
      return 'A different provider subscription replaced one that was still live.';
    case 'equal_provider_timestamp_conflict':
      return 'Two different provider events share one instant and disagree; the earlier-applied state was kept.';
    case 'checkout_correlation_invalid':
      return `The subscription named a checkout that could not be used (${(issue.reason ?? 'unknown').replace(/_/g, ' ')}).`;
    case 'checkout_snapshot_missing':
      return 'The correlated checkout has no recorded snapshot to compare against.';
    default:
      return issue.code.replace(/_/g, ' ');
  }
}
