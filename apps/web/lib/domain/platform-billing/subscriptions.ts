import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * Stripe's own facts about an organization's GOLD subscription, cached by the platform-billing
 * webhook (`apply_platform_subscription_event`) — read-only here. Nothing in this file writes;
 * the return URL from Checkout is never proof of anything (Phase 7).
 */
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
  planId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  updatedAt: string;
};

const COLUMNS =
  'organization_id, environment, status, currency, plan_id, current_period_start, current_period_end, cancel_at_period_end, canceled_at, updated_at';

function toSubscription(row: {
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
}): OrganizationSubscription {
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
  if (error) throw new DomainError(error.message, 'platform_billing.subscription_read_failed');
  return data ? toSubscription(data) : null;
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
  if (error) throw new DomainError(error.message, 'platform_billing.subscription_read_failed');
  return (data ?? []).map(toSubscription);
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
  if (error) throw new DomainError(error.message, 'platform_billing.attention_list_failed');
  return (data ?? []).map(toSubscription);
}

/** Every current GOLD subscription, for the platform staff overview. Same RLS reasoning as above. */
export async function listOrganizationSubscriptions(db: Db): Promise<OrganizationSubscription[]> {
  const { data, error } = await db
    .from('organization_platform_subscriptions')
    .select(COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) throw new DomainError(error.message, 'platform_billing.subscription_list_failed');
  return (data ?? []).map(toSubscription);
}
