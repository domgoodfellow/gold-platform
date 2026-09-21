import type { Db } from '@/lib/db/types';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { getPlanById } from '@/lib/domain/catalogue/plans';
import {
  listSubscriptionsForOrganization,
  type OrganizationSubscription,
} from './subscriptions';

/**
 * Whether an organization may use GOLD's operational surfaces — the one answer to *commercial
 * service access*, derived from facts that already exist: the current base Plan
 * (`organization_plan_assignments`, `platform_plans.billable`) and the processor's cached
 * subscription (`organization_platform_subscriptions`). Nothing is stored for it; a stored
 * `locked` flag would be a second copy of those two facts, waiting to disagree.
 *
 * Three things this is not:
 * - Not `organizations.operational_state`, which is SETUP/LIVE and stays a lifecycle.
 * - Not authentication. A locked person still signs in, and still reaches billing recovery.
 * - Not an entitlement. Which Features a Plan grants is `organization-plans.ts`; this decides
 *   only whether the tenant's workspaces open at all. No RLS policy reads it, and locking
 *   writes nothing — data is never touched, only the doors.
 */

type SubscriptionStatus = OrganizationSubscription['status'];

/**
 * The status mapping, in one place. `Record` over every status so a status the webhook later
 * admits is a compile error here rather than a silent lock or a silent pass. A grace period for
 * `past_due` is one edit: change its entry (or make this a function of the period end) and the
 * `past_due` row of the matrix test.
 */
export const SERVICEABLE_SUBSCRIPTION_STATUS: Readonly<Record<SubscriptionStatus, boolean>> = {
  active: true,
  trialing: true,
  past_due: false,
  unpaid: false,
  canceled: false,
  incomplete: false,
  incomplete_expired: false,
  paused: false,
};

export type ServiceAccessCode =
  /** No current base Plan: nothing has said this organization owes GOLD a subscription. */
  | 'no_plan'
  /** The current base Plan is not billable (GOLD Internal). */
  | 'non_billable_plan'
  | 'subscription_serviceable'
  | 'subscription_missing'
  | 'subscription_not_serviceable';

export type ServiceAccess = {
  permitted: boolean;
  code: ServiceAccessCode;
  planKey: string | null;
  /** The status the decision rested on; null when there is no subscription row (or none was needed). */
  subscriptionStatus: SubscriptionStatus | null;
};

export type ServiceAccessFacts = {
  plan: { key: string; billable: boolean } | null;
  subscriptions: readonly Pick<OrganizationSubscription, 'status' | 'environment'>[];
  /** The environment this deployment bills in; null when billing is unconfigured, in which case every row counts. */
  environment: 'sandbox' | 'live' | null;
};

/** Pure. Every branch of the policy is here and nowhere else. */
export function resolveServiceAccess({ plan, subscriptions, environment }: ServiceAccessFacts): ServiceAccess {
  if (!plan) {
    return { permitted: true, code: 'no_plan', planKey: null, subscriptionStatus: null };
  }
  if (!plan.billable) {
    return { permitted: true, code: 'non_billable_plan', planKey: plan.key, subscriptionStatus: null };
  }

  const relevant = environment ? subscriptions.filter((s) => s.environment === environment) : subscriptions;
  const serviceable = relevant.find((s) => SERVICEABLE_SUBSCRIPTION_STATUS[s.status]);
  if (serviceable) {
    return {
      permitted: true,
      code: 'subscription_serviceable',
      planKey: plan.key,
      subscriptionStatus: serviceable.status,
    };
  }
  const shown = relevant[0];
  if (!shown) {
    return { permitted: false, code: 'subscription_missing', planKey: plan.key, subscriptionStatus: null };
  }
  return {
    permitted: false,
    code: 'subscription_not_serviceable',
    planKey: plan.key,
    subscriptionStatus: shown.status,
  };
}

export async function getOrganizationServiceAccess(
  db: Db,
  input: { organizationId: string; environment: 'sandbox' | 'live' | null },
): Promise<ServiceAccess> {
  const assignment = await currentPlanAssignment(db, { organizationId: input.organizationId });
  const plan = assignment ? await getPlanById(db, assignment.planId) : null;
  // Only a billable Plan consults the subscription cache at all.
  const subscriptions = plan?.billable
    ? await listSubscriptionsForOrganization(db, { organizationId: input.organizationId })
    : [];
  return resolveServiceAccess({
    plan: plan ? { key: plan.key, billable: plan.billable } : null,
    subscriptions,
    environment: input.environment,
  });
}

/** What the tenant and platform staff both read. One sentence per outcome, so the two never paraphrase the policy differently. */
export function describeServiceAccess(access: ServiceAccess): string {
  switch (access.code) {
    case 'no_plan':
      return 'No GOLD Plan is assigned, so no subscription is required.';
    case 'non_billable_plan':
      return 'On a non-billable Plan; no subscription is required.';
    case 'subscription_serviceable':
      return `The GOLD subscription is ${access.subscriptionStatus}.`;
    case 'subscription_missing':
      return 'No GOLD subscription is on record for this Plan.';
    case 'subscription_not_serviceable':
      return `The GOLD subscription is ${(access.subscriptionStatus ?? '').replace('_', ' ')}, which does not currently include service.`;
  }
}
