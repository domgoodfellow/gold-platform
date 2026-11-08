import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

/**
 * The provider's own facts about an organization's GOLD subscription, cached by the
 * platform-billing webhook (`apply_platform_subscription_event`) — read-only here. Nothing in this
 * file writes; the return URL from Checkout is never proof of anything (Phase 7).
 *
 * Three facts that look alike and are not: what the provider currently bills (the items here),
 * what GildOps sold (Plan and Add-on assignments) and what is granted (entitlements). A provider
 * item never becomes an assignment, and a missing one never removes one.
 */
export type SubscriptionReconciliationState = 'matched' | 'mismatch' | 'legacy_unlinked' | 'ambiguous';

/** One thing the reconciliation found, as the database recorded it. Codes are the database's. */
export type ReconciliationIssue = {
  code: string;
  priceReference?: string;
  expectedQuantity?: number | null;
  actualQuantity?: number | null;
  reason?: string;
};

export type OrganizationSubscription = {
  organizationId: string;
  environment: 'sandbox' | 'live';
  status:
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'paused';
  currency: string;
  /** Legacy single-item compatibility (the base Plan item's Plan). New logic reads the items. */
  planId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  updatedAt: string;
  subscriptionReference: string;
  /** The provider item identified as the base Plan, or null when none (or several) could be. */
  baseItemReference: string | null;
  /** The checkout that created this subscription, when its correlation verified. */
  checkoutSessionId: string | null;
  reconciliationState: SubscriptionReconciliationState;
  reconciliationIssues: ReconciliationIssue[];
  reconciledAt: string | null;
  /** The provider's occurrence time of the newest event applied. Null for a row written before events were ordered. */
  lastProviderEventAt: string | null;
};

export type OrganizationSubscriptionItem = {
  id: string;
  organizationId: string;
  environment: 'sandbox' | 'live';
  subscriptionReference: string;
  providerItemReference: string;
  providerPriceReference: string;
  /** What the provider reported; null when it reported none. Never defaulted. */
  quantity: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** The exact canonical price record this provider Price maps to, or null when unknown to GildOps. */
  canonicalSource: {
    domain: 'catalogue.plan_price' | 'catalogue.plan_agreement';
    id: string;
    planId: string | null;
  } | null;
  active: boolean;
  removedAt: string | null;
  lastProviderEventAt: string;
};

export type OrganizationBillingSubscriptionState = {
  subscription: OrganizationSubscription;
  items: OrganizationSubscriptionItem[];
};

const COLUMNS =
  'organization_id, environment, status, currency, plan_id, current_period_start, current_period_end, cancel_at_period_end, canceled_at, updated_at, subscription_reference, base_item_reference, checkout_session_id, reconciliation_state, reconciliation_detail, reconciled_at, last_provider_event_created_at';

const ITEM_COLUMNS =
  'id, organization_id, environment, subscription_reference, provider_item_reference, provider_price_reference, quantity, current_period_start, current_period_end, canonical_source_domain, canonical_source_record_id, plan_id, active, removed_at, last_provider_event_created_at';

type SubscriptionRow = {
  organization_id: string;
  environment: string;
  status: string;
  currency: string;
  plan_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  updated_at: string;
  subscription_reference: string;
  base_item_reference: string | null;
  checkout_session_id: string | null;
  reconciliation_state: string;
  reconciliation_detail: unknown;
  reconciled_at: string | null;
  last_provider_event_created_at: string | null;
};

type ItemRow = {
  id: string;
  organization_id: string;
  environment: string;
  subscription_reference: string;
  provider_item_reference: string;
  provider_price_reference: string;
  quantity: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canonical_source_domain: string | null;
  canonical_source_record_id: string | null;
  plan_id: string | null;
  active: boolean;
  removed_at: string | null;
  last_provider_event_created_at: string;
};

function toIssues(detail: unknown): ReconciliationIssue[] {
  if (!Array.isArray(detail)) return [];
  return detail.flatMap((entry): ReconciliationIssue[] => {
    if (!entry || typeof entry !== 'object' || typeof (entry as { code?: unknown }).code !== 'string') return [];
    const raw = entry as Record<string, unknown>;
    return [
      {
        code: raw.code as string,
        priceReference: typeof raw.price_reference === 'string' ? raw.price_reference : undefined,
        expectedQuantity: typeof raw.expected_quantity === 'number' ? raw.expected_quantity : null,
        actualQuantity: typeof raw.actual_quantity === 'number' ? raw.actual_quantity : null,
        reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      },
    ];
  });
}

function toSubscription(row: SubscriptionRow): OrganizationSubscription {
  return {
    organizationId: row.organization_id,
    environment: row.environment as 'sandbox' | 'live',
    status: row.status as OrganizationSubscription['status'],
    currency: row.currency,
    planId: row.plan_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    updatedAt: row.updated_at,
    subscriptionReference: row.subscription_reference,
    baseItemReference: row.base_item_reference,
    checkoutSessionId: row.checkout_session_id,
    reconciliationState: row.reconciliation_state as SubscriptionReconciliationState,
    reconciliationIssues: toIssues(row.reconciliation_detail),
    reconciledAt: row.reconciled_at,
    lastProviderEventAt: row.last_provider_event_created_at,
  };
}

function toItem(row: ItemRow): OrganizationSubscriptionItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    environment: row.environment as 'sandbox' | 'live',
    subscriptionReference: row.subscription_reference,
    providerItemReference: row.provider_item_reference,
    providerPriceReference: row.provider_price_reference,
    quantity: row.quantity,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    canonicalSource:
      row.canonical_source_domain && row.canonical_source_record_id
        ? {
            domain: row.canonical_source_domain as 'catalogue.plan_price' | 'catalogue.plan_agreement',
            id: row.canonical_source_record_id,
            planId: row.plan_id,
          }
        : null,
    active: row.active,
    removedAt: row.removed_at,
    lastProviderEventAt: row.last_provider_event_created_at,
  };
}

export async function getOrganizationSubscription(
  db: Db,
  input: { organizationId: string },
): Promise<OrganizationSubscription | null> {
  const { data, error } = await db
    .from('organization_platform_subscriptions')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'platform_billing.subscription_read_failed');
  return data ? toSubscription(data) : null;
}

/** Whether the provider's subscription is still the organization's — an ended one is kept as history and is not a subscription to manage or a reason a purchase is already made. */
export function isEndedSubscription(subscription: Pick<OrganizationSubscription, 'status'>): boolean {
  return subscription.status === 'canceled' || subscription.status === 'incomplete_expired';
}

/** Every cached subscription row for one organization — one per environment at most. Access resolution reads this rather than `getOrganizationSubscription`, whose single-row read cannot tell a sandbox row from a live one. */
export async function listSubscriptionsForOrganization(
  db: Db,
  input: { organizationId: string },
): Promise<OrganizationSubscription[]> {
  const { data, error } = await db
    .from('organization_platform_subscriptions')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId);
  if (error) throw fromDatabaseError(error, 'platform_billing.subscription_read_failed');
  return (data ?? []).map(toSubscription);
}

/**
 * The subscription and its current provider items in two bounded reads, however many items there
 * are. Only the items of the subscription the parent currently names — an earlier subscription's
 * removed items are history, not state.
 */
export async function getOrganizationBillingSubscriptionState(
  db: Db,
  input: { organizationId: string },
): Promise<OrganizationBillingSubscriptionState | null> {
  const subscription = await getOrganizationSubscription(db, input);
  if (!subscription) return null;
  const { data, error } = await db
    .from('organization_platform_subscription_items')
    .select(ITEM_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('environment', subscription.environment)
    .eq('subscription_reference', subscription.subscriptionReference)
    .order('provider_item_reference', { ascending: true });
  if (error) throw fromDatabaseError(error, 'platform_billing.subscription_items_read_failed');
  return { subscription, items: (data ?? []).map(toItem) };
}

/**
 * The current items of many organizations' subscriptions in one read, for the staff book — never
 * one query per row. Each subscription's own items only, so a replaced subscription's history is
 * not counted against its successor.
 */
export async function listSubscriptionItems(
  db: Db,
  subscriptions: readonly OrganizationSubscription[],
): Promise<OrganizationSubscriptionItem[]> {
  if (subscriptions.length === 0) return [];
  const { data, error } = await db
    .from('organization_platform_subscription_items')
    .select(ITEM_COLUMNS)
    .in('organization_id', [...new Set(subscriptions.map((s) => s.organizationId))])
    .order('provider_item_reference', { ascending: true });
  if (error) throw fromDatabaseError(error, 'platform_billing.subscription_items_read_failed');
  const current = new Set(subscriptions.map((s) => `${s.organizationId}:${s.environment}:${s.subscriptionReference}`));
  return (data ?? [])
    .map(toItem)
    .filter((item) => current.has(`${item.organizationId}:${item.environment}:${item.subscriptionReference}`));
}

/** past_due/unpaid, for the platform staff console (Phase 5: "organizations requiring attention"). Staff-only by RLS on the underlying select — an ordinary member reading this sees only their own organization's row, never the list. */
export async function listOrganizationsRequiringAttention(
  db: Db,
): Promise<OrganizationSubscription[]> {
  const { data, error } = await db
    .from('organization_platform_subscriptions')
    .select(COLUMNS)
    .in('status', ['past_due', 'unpaid'])
    .order('updated_at', { ascending: false });
  if (error) throw fromDatabaseError(error, 'platform_billing.attention_list_failed');
  return (data ?? []).map(toSubscription);
}

/** Every current GOLD subscription, for the platform staff overview. Same RLS reasoning as above. */
export async function listOrganizationSubscriptions(db: Db): Promise<OrganizationSubscription[]> {
  const { data, error } = await db
    .from('organization_platform_subscriptions')
    .select(COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) throw fromDatabaseError(error, 'platform_billing.subscription_list_failed');
  return (data ?? []).map(toSubscription);
}
