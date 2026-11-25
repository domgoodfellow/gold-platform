import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import { EconomicsViews } from '@/features/finance/economics/economics-views';
import { loadPortfolioEconomics } from '@/lib/application/finance/cost-to-serve';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

/**
 * Finance → Economics (ADR-057): every business GildOps serves this month, what it owes, what it
 * is known to cost to serve and the contribution left — operational economics read once from
 * `platform_revenue_portfolio`, never accounting profit. `cost.read` in GildOps' own organization.
 */
export default async function EconomicsPage({ params }: PageProps<'/organizations/[organizationId]/finance/economics'>) {
  const { organizationId } = await params;
  const { db, gate } = await requireOperatingArea(organizationId, 'finance-economics');
  const portfolioOffered = gate.featureAvailability.has('cost_to_serve');
  const packagesOffered = gate.featureAvailability.has('package_economics');
  if (!portfolioOffered) redirect(`/organizations/${organizationId}/finance/economics/packages`);
  const { period, portfolio, reportingCurrency } = await loadPortfolioEconomics(db);
  const totals = portfolio.reduce(
    (sum, row) => ({ obligation: sum.obligation + row.customerObligationMinor, knownCost: sum.knownCost + row.knownCostToServeMinor, contribution: sum.contribution + row.knownContributionMinor }),
    { obligation: 0, knownCost: 0, contribution: 0 },
  );
  const href = (subscriberId: string) => `/organizations/${organizationId}/finance/economics/${subscriberId}`;

  return (
    <AppPage>
      <PageHeader title="Economics" crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]} />
      <EconomicsViews organizationId={organizationId} current="portfolio" portfolio={portfolioOffered} packages={packagesOffered} />
      <Hint>{new Date(period.start).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · amounts in {reportingCurrency}</Hint>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Owed this month</dt><dd className="font-medium tabular-nums">{formatMoney(totals.obligation, reportingCurrency)}</dd></div>
        <div><dt className="text-muted">Known cost to serve</dt><dd className="font-medium tabular-nums">{formatMoney(totals.knownCost, reportingCurrency)}</dd></div>
        <div><dt className="text-muted">Known contribution</dt><dd className="font-medium tabular-nums">{formatMoney(totals.contribution, reportingCurrency)}</dd></div>
      </dl>
      <DataTable
        rows={portfolio}
        rowKey={(row) => row.organizationId}
        empty="No business has a charge composed for this month yet."
        columns={[
          { key: 'business', header: 'Business', emphasis: 'primary', cell: (row) => <Link href={href(row.organizationId)} className="font-medium underline-offset-4 hover:underline">{row.organizationName}</Link> },
          { key: 'obligation', header: 'Owed', numeric: true, cell: (row) => formatMoney(row.customerObligationMinor, reportingCurrency) },
          { key: 'cost', header: 'Known cost', numeric: true, cell: (row) => formatMoney(row.knownCostToServeMinor, reportingCurrency) },
          { key: 'contribution', header: 'Known contribution', numeric: true, cell: (row) => formatMoney(row.knownContributionMinor, reportingCurrency) },
          { key: 'margin', header: 'Known margin', numeric: true, cell: (row) => pct(row.knownMargin) },
          { key: 'coverage', header: 'Cost coverage', numeric: true, cell: (row) => (row.costCoverage < 1 ? <span className="text-danger">{pct(row.costCoverage)}</span> : pct(row.costCoverage)) },
        ]}
      />
    </AppPage>
  );
}
