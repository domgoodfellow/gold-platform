import { platformParams } from '@/lib/route/platform';
import { platformAncestry } from '@/lib/platform-navigation';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading, DividedList } from '@/components/surfaces/section';
import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { loadOrganizationEconomics } from '@/lib/application/platform/economics-overview';
import { getTenant } from '@/lib/domain/platform/tenants';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { formatMicrosMoney } from '@/lib/domain/commercial/economics';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

const ALLOCATION_QUALITY_LABEL: Record<string, string> = {
  direct: 'Direct',
  measured: 'Measured',
  estimated: 'Estimated',
  shared: 'Shared',
  unallocated: 'Unallocated',
};

const COMPONENT_LABEL: Record<string, string> = {
  resource_direct: 'Resource',
  infrastructure_attributable: 'Infrastructure',
  infrastructure_shared: 'Shared infrastructure',
  manual_direct: 'Manual',
};

/**
 * One organization's revenue, known cost-to-serve, contribution and storage/infrastructure
 * detail for the current month (Work Order B, B5/B8). Staff-only — never reached by the business
 * itself, which sees its own obligation through Settings → Plan & usage and nothing of GildOps'
 * own cost.
 */
export default async function PortfolioEconomicsDetailPage({
  params,
}: PageProps<'/platform/economics/[targetOrganizationId]'>) {
  const { organizationId, targetOrganizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.commercial');
  const db = await getDb();
  const tenant = await getTenant(db, targetOrganizationId);
  if (!tenant) notFound();
  const { period, revenue, cost, infrastructureCosts, storage } = await loadOrganizationEconomics(db, { organizationId: targetOrganizationId });

  return (
    <AppPage>
      <PageHeader
        title={tenant.name}
        crumbs={[
          ...platformAncestry(organizationId, 'portfolio-economics'),
          { label: 'Portfolio economics', href: `/platform/economics` },
        ]}
      />
      <Hint className="mb-5">
        {new Date(period.start).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })} · amounts in {revenue.reportingCurrency}
        {revenue.hasMixedCurrency ? ' · some components are in a different currency and are excluded from these totals' : ''}
      </Hint>

      <Section>
        <SectionHeading>Revenue</SectionHeading>
        <DividedList as="div" className="mt-2">
          <Row label="Base Plan" value={revenue.basePlanMinor} currency={revenue.reportingCurrency} />
          <Row label="Add-ons" value={revenue.addonMinor} currency={revenue.reportingCurrency} />
          <Row label="Recurring resources" value={revenue.recurringResourceMinor} currency={revenue.reportingCurrency} />
          <Row label="Usage overage" value={revenue.usageOverageMinor} currency={revenue.reportingCurrency} />
          <Row label="One-time services" value={revenue.oneTimeServiceMinor} currency={revenue.reportingCurrency} />
          <Row label="Debit adjustments" value={revenue.debitAdjustmentMinor} currency={revenue.reportingCurrency} />
          <Row label="Credit adjustments" value={-revenue.creditAdjustmentMinor} currency={revenue.reportingCurrency} />
          <Row label="Customer obligation" value={revenue.customerObligationMinor} currency={revenue.reportingCurrency} strong />
        </DividedList>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Known cost-to-serve</SectionHeading>
        <DividedList as="div" className="mt-2">
          <Row label="Usage-direct" value={cost.directUsageCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Resources" value={cost.resourceCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Infrastructure-attributable" value={cost.infrastructureAttributableCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Manual direct" value={cost.manualDirectCogsMicros / 1_000_000} currency={cost.reportingCurrency} />
          <Row label="Known attributable COGS" value={cost.attributableKnownCogsMicros / 1_000_000} currency={cost.reportingCurrency} strong />
        </DividedList>
        <p className="mt-3 text-sm text-muted">
          Cost coverage: {pct(revenue.costCoverage)}
          {revenue.costCoverage < 1 ? ' — some cost components are not yet known in this currency.' : ''}
          {cost.directUsageHasUnknown ? ' Some usage cost is still unknown.' : ''}
        </p>
        <p className="mt-1 text-sm text-subtle">
          Shared platform overhead this month: {formatMoney(Math.round(cost.sharedPlatformCostMicros / 1_000_000), cost.reportingCurrency)} ·
          Unallocated: {formatMoney(Math.round(cost.unallocatedCostMicros / 1_000_000), cost.reportingCurrency)}
          {' — neither is counted against this organization.'}
        </p>
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
              <span className="font-medium">Customer allowance</span>
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
        <SectionHeading>Infrastructure &amp; resource cost components</SectionHeading>
        {infrastructureCosts.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing recorded for this organization this month.</p>
        ) : (
          <DividedList as="div" className="mt-2">
            {infrastructureCosts.map((row) => (
              <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{COMPONENT_LABEL[row.costCategory] ?? row.costCategory}</span>
                  <span className="ml-2 text-xs text-subtle">{row.providerKey ?? 'manual'}</span>
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
