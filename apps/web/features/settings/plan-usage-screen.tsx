import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { settingsLandingHref } from '@/lib/route/settings';
import type { PlanUsageModel } from '@/lib/application/settings/plan-usage';
import { ManageBillingButton, SubscribeButton } from '@/features/settings/platform-billing-forms';
import { AllowanceMeter } from '@/features/catalogue/allowance-meter';
import type { UsageEvent } from '@/lib/domain/commercial/usage';

function formatMinor(amountMinor: number, currency: string | null): string {
  if (!currency) return String(amountMinor);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}


/**
 * How much of one reading the plan covered. Reads the split `app.record_usage` stored at the
 * moment the usage occurred — nothing is recomputed here against today's plan, which is what
 * keeps an old reading saying what it said when it happened (I8).
 */
function usageSplit(entry: UsageEvent): string {
  switch (entry.allowanceApplication) {
    case 'included':
      return 'included in the plan';
    case 'partly_included':
      return `${entry.includedQuantity?.toLocaleString('en-CA')} included · ${entry.overageQuantity?.toLocaleString('en-CA')} additional`;
    case 'overage':
      return 'additional usage';
    default:
      return '';
  }
}

/**
 * Three different financial facts, never one zero: covered by the allowance, rated at nothing, or
 * carrying no rate at all.
 */
function usageCharge(entry: UsageEvent, format: (minor: number, currency: string | null) => string): string {
  if (entry.retailState === 'no_currency') return 'No currency set';
  if (entry.retailState === 'no_rate') return 'Not priced yet';
  if (entry.customerChargeMinor === 0 && entry.allowanceApplication === 'included') return 'No extra charge';
  return format(entry.customerChargeMinor ?? 0, entry.customerCurrency);
}

/**
 * What this business is entitled to use, what GOLD has recorded selling it, what it used, and
 * what that cost it — never what it cost GOLD, and never a margin (`constraints.md` D43). A
 * detail route under Settings, so it writes its own heading rather than
 * one `navigation.ts` also owns.
 */
export function PlanUsageScreen({ organizationId, currency, model }: { organizationId: string; currency: string | null; model: PlanUsageModel }) {
  const { terms, usage, account, basePlan, addonPlans, allowances, meterLabel, productLabel,
    billingProvider, subscription, subscribablePrice, canManageBilling } = model;

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Plan & usage"
        crumbs={[{ label: 'Settings', href: settingsLandingHref(organizationId) }]}
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
                ? `GildOps has not priced ${basePlan.label} in ${currency || 'this business’s currency'} yet.`
                : 'No Plan is assigned to subscribe to yet.'}
            </EmptyState>
          )}
        </Section>
      ) : null}

      {allowances.length > 0 ? (
        <Section className="mt-8">
          <SectionHeading>What’s included</SectionHeading>
          <Hint className="mt-1">
            What this business’s plan allows, how much of it has been used, and when it resets.
          </Hint>
          <DividedList as="div" className="mt-2">
            {allowances.map((allowance) => (
              <AllowanceMeter key={allowance.allowanceKey} state={allowance} />
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
                <span className="font-medium">{meterLabel.get(entry.meterId) ?? entry.meterId}</span>
                <span className="tabular-nums">{entry.quantity.toLocaleString('en-CA')}</span>
                <span className="text-xs text-subtle">{usageSplit(entry)}</span>
                <span className="tabular-nums">{usageCharge(entry, formatMinor)}</span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Calling credit</SectionHeading>
        {account.priced ? (
          <Hint className="mt-1">
            {formatMinor(account.balanceMinor, currency)} left.
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
