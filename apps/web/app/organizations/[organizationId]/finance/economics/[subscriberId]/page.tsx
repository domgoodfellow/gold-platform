import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading, DividedList } from '@/components/surfaces/section';
import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { ALLOCATION_QUALITY_LABEL, COST_CATEGORY_LABEL } from '@/features/finance/costs/cost-labels';
import { loadOrganizationEconomics } from '@/lib/application/finance/cost-to-serve';
import { getTenant } from '@/lib/domain/platform/tenants';
import { subscriptionsForTenants } from '@/lib/domain/catalogue/organization-plans';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { formatMicrosMoney } from '@/lib/domain/commercial/economics';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

function formatGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toLocaleString('en-CA', { maximumFractionDigits: 1 })} GB`;
}

function Row({ label, value, currency, strong }: { label: string; value: number; currency: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-x-3 py-2 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'font-medium'}>{label}</span>
      <span className="tabular-nums">{formatMoney(Math.round(value), currency)}</span>
    </div>
  );
}

/**
 * What one business GildOps serves owes this month, what it is known to cost to serve, and the
 * contribution left (ADR-057). `cost.read` in GildOps' own organization — never reached by the
 * business itself, which sees what it owes in Settings → Plan & usage and nothing of GildOps' cost.
 */
export default async function CostToServePage({ params }: PageProps<'/organizations/[organizationId]/finance/economics/[subscriberId]'>) {
  const { organizationId, subscriberId } = await params;
  const { db, gate } = await requireOperatingArea(organizationId, 'finance-economics');
  if (!gate.featureAvailability.has('cost_to_serve')) notFound();
  const tenant = await getTenant(db, subscriberId);
  if (!tenant) notFound();
  const [{ period, revenue, cost, infrastructureCosts, storage }, subscriptionByTenant] = await Promise.all([
    loadOrganizationEconomics(db, { organizationId: subscriberId }),
    gate.featureAvailability.has('subscriptions') ? subscriptionsForTenants(db, { organizationId, tenantIds: [subscriberId] }) : Promise.resolve(new Map<string, string>()),
  ]);
  const subscriptionId = subscriptionByTenant.get(subscriberId);
  const finance = `/organizations/${organizationId}/finance`;

  return (
    <AppPage>
      <PageHeader
        title={tenant.name}
        crumbs={[{ label: 'Finance', href: finance }, { label: 'Economics', href: `${finance}/economics` }]}
        actions={subscriptionId ? <ButtonLink href={`${finance}/subscriptions/${subscriptionId}`} tone="secondary" size="small">Subscription</ButtonLink> : undefined}
      />
      <Hint className="mb-5">
        {new Date(period.start).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · amounts in {revenue.reportingCurrency}
        {revenue.hasMixedCurrency ? ' · parts in another currency are left out of these totals' : ''}
      </Hint>

      <Section>
        <SectionHeading>Revenue</SectionHeading>
        <DividedList as="div" className="mt-2">
          <Row label="Plan" value={revenue.basePlanMinor} currency={revenue.reportingCurrency} />
          <Row label="Add-ons" value={revenue.addonMinor} currency={revenue.reportingCurrency} />
          <Row label="Recurring resources" value={revenue.recurringResourceMinor} currency={revenue.reportingCurrency} />
          <Row label="Usage beyond allowances" value={revenue.usageOverageMinor} currency={revenue.reportingCurrency} />
          <Row label="One-time services" value={revenue.oneTimeServiceMinor} currency={revenue.reportingCurrency} />
          <Row label="Debit adjustments" value={revenue.debitAdjustmentMinor} currency={revenue.reportingCurrency} />
          <Row label="Credit adjustments" value={-revenue.creditAdjustmentMinor} currency={revenue.reportingCurrency} />
          <Row label="Owed this month" value={revenue.customerObligationMinor} currency={revenue.reportingCurrency} strong />
        </DividedList>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Known cost to serve</SectionHeading>
        <DividedList as="div" className="mt-2">
          <Row label="Usage" value={cost.directUsageCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Resources" value={cost.resourceCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Infrastructure for this business" value={cost.infrastructureAttributableCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Other direct costs" value={cost.manualDirectCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Known cost to serve" value={cost.attributableKnownCogsMicros / 1_000_000} currency={cost.reportingCurrency} strong />
        </DividedList>
        <DividedList as="div" className="mt-4">
          <div className="flex items-baseline justify-between gap-x-3 py-2 text-sm">
            <span className="font-medium">Cost coverage</span>
            <span className={`tabular-nums ${revenue.costCoverage < 1 ? 'text-danger' : ''}`}>{pct(revenue.costCoverage)}{cost.directUsageHasUnknown ? ' · some usage cost unknown' : ''}</span>
          </div>
          <Row label="Shared infrastructure, not counted here" value={cost.sharedPlatformCostMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Unallocated, not counted here" value={cost.unallocatedCostMicros / 1_000_000} currency={cost.reportingCurrency} />
        </DividedList>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Contribution</SectionHeading>
        <DividedList as="div" className="mt-2">
          <Row label="Known contribution" value={revenue.knownContributionMinor} currency={revenue.reportingCurrency} strong />
          <div className="flex items-baseline justify-between gap-x-3 py-2 text-sm">
            <span className="font-medium">Known margin</span>
            <span className="tabular-nums">{pct(revenue.knownMargin)}</span>
          </div>
        </DividedList>
      </Section>

      {storage ? (
        <Section className="mt-8">
          <SectionHeading>Storage</SectionHeading>
          <DividedList as="div" className="mt-2">
            <div className="flex items-baseline justify-between gap-x-3 py-2 text-sm">
              <span className="font-medium">Allowance</span>
              <span className="tabular-nums">{storage.included === null ? '—' : formatGb(storage.included)} / {formatGb(storage.hardLimit ?? storage.included ?? 0)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-x-3 py-2 text-sm">
              <span className="font-medium">Currently stored</span>
              <span className="tabular-nums">{storage.consumed === null ? 'Not measured' : formatGb(storage.consumed)}</span>
            </div>
          </DividedList>
        </Section>
      ) : null}

      <Section className="mt-8">
        <SectionHeading>Recorded costs</SectionHeading>
        {infrastructureCosts.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing recorded for this business this month.</p>
        ) : (
          <DividedList as="div" className="mt-2">
            {infrastructureCosts.map((row) => (
              <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{COST_CATEGORY_LABEL[row.costCategory] ?? row.costCategory}</span>
                  <span className="ml-2 text-xs text-subtle">{row.providerKey ?? 'no supplier'}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge>{ALLOCATION_QUALITY_LABEL[row.allocationQuality] ?? row.allocationQuality}</Badge>
                  <span className="tabular-nums">{formatMicrosMoney(row.reportingCostMicros, row.reportingCurrency)}</span>
                </span>
              </div>
            ))}
          </DividedList>
        )}
      </Section>
    </AppPage>
  );
}
