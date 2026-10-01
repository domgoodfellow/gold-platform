import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { SettingsScopeNav } from '@/features/settings/settings-scope-nav';
import { communicationsAccount } from '@/lib/domain/communications/credits';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms } from '@/lib/domain/commercial/terms';
import { listUsageEvents } from '@/lib/domain/commercial/usage';
import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';
import { getPlanById, listPlanPrices } from '@/lib/domain/catalogue/plans';
import {
  currentAddonAssignments,
  currentPlanAssignment,
  organizationEffectiveQuotas,
} from '@/lib/domain/catalogue/organization-plans';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { getOrganizationSubscription } from '@/lib/domain/platform-billing/subscriptions';
import { ManageBillingButton, SubscribeButton } from '@/features/settings/platform-billing-forms';

export const dynamic = 'force-dynamic';

function formatMinor(amountMinor: number, currency: string | null): string {
  if (!currency) return String(amountMinor);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

/**
 * What this business is entitled to use, what GOLD has recorded selling it, what it used, and
 * what that cost it — never what it cost GOLD, and never a margin (`constraints.md` D43). A
 * detail route under Settings, so it writes its own heading rather than
 * one `navigation.ts` also owns.
 */
export default async function PlanAndUsagePage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/plan'>) {
  const { organizationId } = await params;
  // Recovery mode: this is where a locked business fixes its subscription, so it cannot be behind the guard that locks it out.
  const { db, organization } = await requireOrganizationForBillingRecovery(organizationId);

  const [terms, products, usage, account, basePlanAssignment, addonAssignments, quotas] = await Promise.all([
    listOrganizationTerms(db, { organizationId }),
    listProducts(db),
    listUsageEvents(db, { organizationId, limit: 50 }),
    communicationsAccount(db, { organizationId, currency: organization.currency }),
    currentPlanAssignment(db, { organizationId }),
    currentAddonAssignments(db, { organizationId }),
    organizationEffectiveQuotas(db, { organizationId }),
  ]);

  const productLabel = new Map(products.map((product) => [product.key, product.label]));

  const [basePlan, addonPlans] = await Promise.all([
    basePlanAssignment ? getPlanById(db, basePlanAssignment.planId) : Promise.resolve(null),
    Promise.all(addonAssignments.map((a) => getPlanById(db, a.planId))),
  ]);

  const billingProvider = await platformBillingProvider();
  const [subscription, basePlanPrices] = await Promise.all([
    billingProvider ? getOrganizationSubscription(db, { organizationId }) : Promise.resolve(null),
    basePlan ? listPlanPrices(db, basePlan.id) : Promise.resolve([]),
  ]);
  const subscribablePrice = organization.currency
    ? basePlanPrices.find((p) => p.approvalState === 'approved' && p.currency === organization.currency)
    : undefined;
  const canManageBilling = organization.capabilities.includes('billing.manage');

  return (
    <SettingsPageFrame>
      <SettingsScopeNav
        organizationId={organizationId}
        active="plan"
        title="Plan & usage"
        crumbs={[{ label: 'Settings', href: `/organizations/${organizationId}/settings` }]}
        actions={<ButtonLink href={`/organizations/${organizationId}/settings/features`}>Manage features</ButtonLink>}
      />

      <Section className="mt-8">
        <SectionHeading>Plan</SectionHeading>
        {basePlan ? (
          <div className="mt-2 text-sm">
            <p className="font-medium">{basePlan.label}</p>
            {addonPlans.length > 0 ? (
              <p className="mt-1 text-muted">Add-ons: {addonPlans.map((p) => p?.label).filter(Boolean).join(', ')}</p>
            ) : null}
          </div>
        ) : (
          <EmptyState className="mt-2">
            This organization does not currently have a standard Plan. Existing purchased terms
            below still apply.
          </EmptyState>
        )}
      </Section>

      {billingProvider ? (
        <Section className="mt-8">
          <SectionHeading>Billing</SectionHeading>
          {subscription ? (
            <div className="mt-2 text-sm">
              <p>
                Status: <span className="font-medium">{subscription.status.replace('_', ' ')}</span>
                {subscription.currentPeriodEnd
                  ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                  : ''}
                {subscription.cancelAtPeriodEnd ? ' · canceling at period end' : ''}
              </p>
              {canManageBilling ? (
                <div className="mt-3">
                  <ManageBillingButton organizationId={organizationId} />
                </div>
              ) : (
                <Hint className="mt-2">Only this business’s billing manager can manage billing.</Hint>
              )}
            </div>
          ) : basePlan && subscribablePrice ? (
            <div className="mt-2 text-sm">
              <p className="text-muted">Not yet subscribed.</p>
              {canManageBilling ? (
                <div className="mt-3">
                  <SubscribeButton organizationId={organizationId} planKey={basePlan.key} planLabel={basePlan.label} />
                </div>
              ) : (
                <Hint className="mt-2">Only this business’s billing manager can start a subscription.</Hint>
              )}
            </div>
          ) : (
            <EmptyState className="mt-2">
              {basePlan
                ? `GildOps has not priced ${basePlan.label} in ${organization.currency ?? 'this business’s currency'} yet.`
                : 'No Plan is assigned to subscribe to yet.'}
            </EmptyState>
          )}
        </Section>
      ) : null}

      {quotas.length > 0 ? (
        <Section className="mt-8">
          <SectionHeading>Usage allowances</SectionHeading>
          <DividedList as="div" className="mt-2">
            {quotas.map((quota) => (
              <div key={`${quota.planKey}-${quota.allowanceKey}`} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">{quota.label}</span>
                <span className="text-muted">
                  {quota.includedQuantity.toLocaleString()} {quota.unit}
                  {quota.period !== 'none' ? ` / ${quota.period}` : ''}
                </span>
                {quota.overridden ? <span className="text-xs text-subtle">(adjusted for this business)</span> : null}
              </div>
            ))}
          </DividedList>
        </Section>
      ) : null}

      <Section className="mt-8">
        <SectionHeading>What&rsquo;s been bought</SectionHeading>
        {terms.length === 0 ? (
          <EmptyState className="mt-2">Nothing recorded yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {terms.map((term) => (
              <div key={term.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">{productLabel.get(term.productKey) ?? term.productKey}</span>
                <span className="text-muted">
                  {term.periodStart} – {term.periodEnd === '9999-12-31' ? 'ongoing' : term.periodEnd}
                </span>
                <span className="tabular-nums">
                  {term.priceMinor === 0 ? 'No charge' : formatMinor(term.priceMinor, term.currency)}
                </span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Usage</SectionHeading>
        <Hint className="mt-1">
          What GildOps charged for what this business used. Recent activity, most recent first.
        </Hint>
        {usage.length === 0 ? (
          <EmptyState className="mt-2">Nothing metered yet.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {usage.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="tabular-nums text-subtle">
                  {new Date(entry.occurredAt).toLocaleString('en-CA')}
                </span>
                <span className="font-medium">{entry.meterId}</span>
                <span>{entry.quantity}</span>
                <span className="tabular-nums">{entry.customerChargeMinor === null ? 'Not priced yet' : formatMinor(entry.customerChargeMinor, entry.customerCurrency)}</span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Calling credit</SectionHeading>
        {account.priced ? (
          <Hint className="mt-1">
            {formatMinor(account.balanceMinor, organization.currency)} left.
          </Hint>
        ) : (
          <EmptyState className="mt-2">
            This deployment has not priced any channel for this business, so nothing is drawn down.
          </EmptyState>
        )}
      </Section>
    </SettingsPageFrame>
  );
}
