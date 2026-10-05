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
 * **Payment is mandatory at Launch, not at Setup.** A business in SETUP that has never had a
 * subscription (none, or a checkout that never completed) keeps its doors open so it can be
 * configured; the moment it is LIVE the same facts lock it. A subscription that existed and
 * lapsed (`past_due`, `unpaid`, `canceled`, `paused`) locks in either state — that is a
 * restriction, not an onboarding gap. Launch itself asks the same resolver as if live
 * (`computeReadiness`), so a business cannot go live into a lock.
 *
 * Three things this is not:
 * - Not `organizations.operational_state` — that stays a lifecycle, and is one *input* here, read
 *   from the organization and never copied into a flag of its own.
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
  /** In SETUP with a billable Plan and no subscription that ever took effect. Permitted; Launch is not. */
  | 'subscription_pending_setup'
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
  /** `organizations.operational_state`. Required: a caller that forgot it would silently choose a policy. */
  operationalState: 'setup' | 'live';
};

/** A subscription in one of these never took effect, so it is an onboarding gap rather than a lapse. */
const NEVER_TOOK_EFFECT: ReadonlySet<SubscriptionStatus> = new Set(['incomplete', 'incomplete_expired']);

/** Pure. Every branch of the policy is here and nowhere else. */
export function resolveServiceAccess({
  plan,
  subscriptions,
  environment,
  operationalState,
}: ServiceAccessFacts): ServiceAccess {
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
  if (operationalState === 'setup' && relevant.every((s) => NEVER_TOOK_EFFECT.has(s.status))) {
    return {
      permitted: true,
      code: 'subscription_pending_setup',
      planKey: plan.key,
      subscriptionStatus: relevant[0]?.status ?? null,
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
  input: {
    organizationId: string;
    environment: 'sandbox' | 'live' | null;
    operationalState: 'setup' | 'live';
  },
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
    operationalState: input.operationalState,
  });
}

/** What the tenant and platform staff both read. One sentence per outcome, so the two never paraphrase the policy differently. */
export function describeServiceAccess(access: ServiceAccess): string {
  switch (access.code) {
    case 'no_plan':
      return 'No GildOps Plan is assigned, so no subscription is required.';
    case 'non_billable_plan':
      return 'On a non-billable Plan; no subscription is required.';
    case 'subscription_serviceable':
      return `The GildOps subscription is ${access.subscriptionStatus}.`;
    case 'subscription_pending_setup':
      return 'Setup is open. A GildOps subscription is required before this business can launch.';
    case 'subscription_missing':
      return 'No GildOps subscription is on record for this Plan.';
    case 'subscription_not_serviceable':
      return `The GildOps subscription is ${(access.subscriptionStatus ?? '').replace('_', ' ')}, which does not currently include service.`;
  }
}
