import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { loadPortfolioEconomics } from '@/lib/application/platform/economics-overview';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry } from '@/lib/platform-navigation';

export const dynamic = 'force-dynamic';

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/**
 * GildOps' commercial portfolio economics (Work Order B, B8/B9): every organization with a
 * composed charge this month, its known cost-to-serve and contribution, and how complete that
 * cost figure actually is. Never accounting profit — operational commercial economics, read
 * straight from `platform_revenue_portfolio` rather than totalled here a second time (I4).
 */
export default async function PortfolioEconomicsPage({ params }: PageProps<'/organizations/[organizationId]/platform/economics'>) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  const db = await getDb();
  const { period, portfolio, reportingCurrency } = await loadPortfolioEconomics(db);

  const totals = portfolio.reduce(
    (sum, row) => ({
      obligation: sum.obligation + row.customerObligationMinor,
      knownCost: sum.knownCost + row.knownCostToServeMinor,
      contribution: sum.contribution + row.knownContributionMinor,
    }),
    { obligation: 0, knownCost: 0, contribution: 0 },
  );

  return (
    <AppPage>
      <PageHeader
        title="Portfolio economics"
        crumbs={platformAncestry(organizationId, 'portfolio-economics')}
      />
      <Hint className="mb-4">
        {new Date(period.start).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })} · amounts in {reportingCurrency} ·
        every organization with a composed charge this month, ranked by what it owes.
      </Hint>

      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Customer obligations</dt>
          <dd className="font-medium tabular-nums">{formatMoney(totals.obligation, reportingCurrency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Known attributable COGS</dt>
          <dd className="font-medium tabular-nums">{formatMoney(totals.knownCost, reportingCurrency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Known contribution</dt>
          <dd className="font-medium tabular-nums">{formatMoney(totals.contribution, reportingCurrency)}</dd>
        </div>
      </dl>

      <DataTable
        rows={portfolio}
        rowKey={(row) => row.organizationId}
        empty="No organization has a composed charge for this month yet."
        columns={[
          {
            key: 'organization',
            header: 'Organization',
            emphasis: 'primary',
            cell: (row) => (
              <Link
                href={`/organizations/${organizationId}/platform/economics/${row.organizationId}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {row.organizationName}
              </Link>
            ),
          },
          { key: 'obligation', header: 'Obligation', numeric: true, cell: (row) => formatMoney(row.customerObligationMinor, reportingCurrency) },
          { key: 'cost', header: 'Known COGS', numeric: true, cell: (row) => formatMoney(row.knownCostToServeMinor, reportingCurrency) },
          { key: 'contribution', header: 'Known contribution', numeric: true, cell: (row) => formatMoney(row.knownContributionMinor, reportingCurrency) },
          { key: 'margin', header: 'Known margin', numeric: true, cell: (row) => pct(row.knownMargin) },
          {
            key: 'coverage',
            header: 'Cost coverage',
            numeric: true,
            cell: (row) => (row.costCoverage < 1 ? <span className="text-danger">{pct(row.costCoverage)}</span> : pct(row.costCoverage)),
          },
        ]}
      />
    </AppPage>
  );
}
