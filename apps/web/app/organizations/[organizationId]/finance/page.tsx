import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { ButtonLink } from '@/components/controls/button';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { financeOverview } from '@/lib/application/finance/finance-overview';
import { loadPortfolioEconomics } from '@/lib/application/finance/economics-overview';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { isGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

function billingIntervalLabel(interval: 'month' | 'year' | 'one_time'): string {
  if (interval === 'month') return '/month';
  if (interval === 'year') return '/year';
  return '';
}

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting',
  active: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
};

/**
 * Finance Home: what is happening financially in this business right now, summarized from reads
 * that already exist — never a second calculation, never GOLD's own cost or a margin (D43). Every
 * tile links to the surface that actually owns the detail: Settings → Plan & usage for the
 * subscription and its history, Settings → Connections for financial systems. Only one page for
 * now (D68's discipline against a placeholder row): a Billing, Usage or Insights page of its own
 * arrives once it has real, distinct content Home cannot already say in one line.
 */
export default async function FinancePage({
  params,
}: PageProps<'/organizations/[organizationId]/finance'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const overview = await financeOverview(db, { organizationId, currency: organization.currency });
  const planPath = `/organizations/${organizationId}/settings/plan`;
  const connectionsPath = `/organizations/${organizationId}/settings/connections/apps`;

  // Plan & Add-on administration is GildOps' own commercial packaging (D25, D43), conditionally
  // visible in this same Finance workspace rather than a second application (D59) — never for a
  // customer's own business, and only for the staff permission that already gates it.
  const isGoldInternal = await isGoldInternalOrganization(db, { organizationId });
  const canManagePlans = isGoldInternal && (await platformPermissions(db)).has('platform.commercial');
  // GildOps' own portfolio economics (Work Order B, B8/B9): conditional operator capability
  // inside GildOps' own organization, the same shape canManagePlans already is — never shown on
  // an ordinary tenant's Finance Home, which has no provider cost or margin to show (D43).
  const economics = canManagePlans ? await loadPortfolioEconomics(db) : null;
  const economicsTotals = economics?.portfolio.reduce(
    (sum, row) => ({
      obligation: sum.obligation + row.customerObligationMinor,
      knownCost: sum.knownCost + row.knownCostToServeMinor,
      contribution: sum.contribution + row.knownContributionMinor,
      worstCoverage: Math.min(sum.worstCoverage, row.costCoverage),
    }),
    { obligation: 0, knownCost: 0, contribution: 0, worstCoverage: 1 },
  );

  const subscriptionValue = overview.subscription
    ? overview.subscription.planLabel
    : 'No plan';
  const subscriptionNote = overview.subscription
    ? overview.subscription.subscription
      ? `${overview.subscription.subscription.status.replace('_', ' ')}${
          overview.subscription.subscription.currentPeriodEnd
            ? ` · renews ${new Date(overview.subscription.subscription.currentPeriodEnd).toLocaleDateString()}`
            : ''
        }`
      : overview.subscription.price
        ? `${formatMoney(overview.subscription.price.amountMinor, overview.subscription.price.currency)}${billingIntervalLabel(overview.subscription.price.billingInterval)} · not yet subscribed`
        : organization.currency
          ? `GildOps has not priced this plan in ${organization.currency} yet — contact sales.`
          : 'No currency set for this business yet.'
    : 'No Plan is assigned to this business yet.';

  const empty =
    !overview.subscription &&
    overview.quotas.length === 0 &&
    overview.recentUsage.length === 0 &&
    overview.financialConnections.length === 0;

  return (
    <WorkspaceHome
      title={workspaceLabel('finance')}
      actions={
        <div className="flex gap-2">
          {canManagePlans ? <ButtonLink href={`/organizations/${organizationId}/finance/economics`} tone="secondary">Economics</ButtonLink> : null}
          {canManagePlans ? <ButtonLink href={`/organizations/${organizationId}/finance/plans`} tone="secondary">Plans &amp; Add-ons</ButtonLink> : null}
          <ButtonLink href={planPath}>Manage plan &amp; billing</ButtonLink>
        </div>
      }
    >
      {economics && economicsTotals ? (
        <Section className="mb-6">
          <SectionHeading>GildOps commercial economics — this month</SectionHeading>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Obligations</dt><dd className="font-medium tabular-nums">{formatMoney(economicsTotals.obligation, economics.reportingCurrency)}</dd></div>
            <div><dt className="text-muted">Known COGS</dt><dd className="font-medium tabular-nums">{formatMoney(economicsTotals.knownCost, economics.reportingCurrency)}</dd></div>
            <div><dt className="text-muted">Known contribution</dt><dd className="font-medium tabular-nums">{formatMoney(economicsTotals.contribution, economics.reportingCurrency)}</dd></div>
            <div>
              <dt className="text-muted">Organizations needing attention</dt>
              <dd className="font-medium tabular-nums">{economics.portfolio.filter((row) => row.costCoverage < 1).length}</dd>
            </div>
          </dl>
        </Section>
      ) : null}
      {empty ? (
        <EmptyState title="Nothing financial recorded yet" description="A plan, a connection or any usage for this business will show here." />
      ) : (
        <WidgetGrid>
          <Widget title="Plan & usage" value={subscriptionValue} note={subscriptionNote} href={planPath} />

          <Widget title="Usage allowances" href={planPath}>
            {overview.quotas.length === 0 ? (
              <EmptyState>No allowances configured.</EmptyState>
            ) : (
              <DividedList as="div" className="text-sm">
                {overview.quotas.slice(0, 4).map((quota) => (
                  <div key={`${quota.planKey}-${quota.allowanceKey}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <span className="font-medium">{quota.label}</span>
                    <span className="text-muted">
                      {quota.includedQuantity.toLocaleString()} {quota.unit}
                      {quota.period !== 'none' ? ` / ${quota.period}` : ''}
                    </span>
                  </div>
                ))}
              </DividedList>
            )}
          </Widget>

          <Widget title="Recent activity" href={planPath}>
            {overview.recentUsage.length === 0 ? (
              <EmptyState>Nothing metered recently.</EmptyState>
            ) : (
              <DividedList as="div" className="text-sm">
                {overview.recentUsage.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <span>{entry.meterId}</span>
                    <span className="tabular-nums text-muted">
                      {entry.customerChargeMinor === null
                        ? 'Not priced yet'
                        : formatMoney(entry.customerChargeMinor, entry.customerCurrency ?? 'USD')}
                    </span>
                  </div>
                ))}
              </DividedList>
            )}
          </Widget>

          <Widget title="Financial connections" href={connectionsPath}>
            {overview.financialConnections.length === 0 ? (
              <EmptyState>
                {overview.hasConnectableFinancialConnector
                  ? 'Connect a financial system to bring its activity into Finance.'
                  : 'No financial system connector is available to connect yet.'}
              </EmptyState>
            ) : (
              <DividedList as="div" className="text-sm">
                {overview.financialConnections.map((connection) => (
                  <div key={connection.connectorKey} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <span>{connection.connectorName}</span>
                    <span className="text-muted">{CONNECTION_STATUS_LABEL[connection.status]}</span>
                  </div>
                ))}
              </DividedList>
            )}
          </Widget>
        </WidgetGrid>
      )}
    </WorkspaceHome>
  );
}
