import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { loadSubscriptions } from '@/lib/application/finance/subscriptions';
import { RECONCILIATION_STATE_LABEL } from '@/lib/domain/platform-billing/reconciliation';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Finance → Subscriptions (ADR-057): every business GildOps serves, its plan and price in force,
 * and the billing provider's state. Offered by the operator Product to members holding
 * `subscription.read`; the database answers only to that permission in GildOps' own organization.
 */
export default async function SubscriptionsPage({ params }: PageProps<'/organizations/[organizationId]/finance/subscriptions'>) {
  const { organizationId } = await params;
  const { db } = await requireOperatingArea(organizationId, 'finance-subscriptions');
  const rows = await loadSubscriptions(db);
  const href = (subscriberId: string) => `/organizations/${organizationId}/finance/subscriptions/${subscriberId}`;

  return (
    <AppPage>
      <PageHeader title="Subscriptions" crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]} />
      <DataTable
        rows={rows}
        rowKey={(row) => row.tenant.id}
        empty="No business subscribes yet."
        columns={[
          { key: 'business', header: 'Business', emphasis: 'primary', cell: (row) => <Link href={href(row.tenant.id)} className="font-medium underline-offset-4 hover:underline">{row.tenant.name}</Link> },
          { key: 'plan', header: 'Plan', cell: (row) => (row.plan ? `${row.plan.label}${row.addonCount ? ` + ${row.addonCount} add-on${row.addonCount === 1 ? '' : 's'}` : ''}` : '—') },
          { key: 'price', header: 'Price', numeric: true, cell: (row) => (row.effective ? <>{formatMoney(row.effective.amountMinor, row.effective.currency)}{row.effective.source === 'agreement' ? <span className="text-muted-foreground"> agreed</span> : null}</> : '—') },
          { key: 'billing', header: 'Billing', cell: (row) => (row.billing ? <Badge tone={row.billing.status === 'active' || row.billing.status === 'trialing' ? 'success' : 'neutral'}>{row.billing.status.replace('_', ' ')}</Badge> : 'Not billed') },
          { key: 'reconciliation', header: 'Matches checkout', visibility: 'card-only', cell: (row) => (row.billing ? RECONCILIATION_STATE_LABEL[row.billing.reconciliationState] : '—') },
          { key: 'access', header: 'Service', cell: (row) => <Badge tone={row.access.permitted ? 'success' : 'danger'}>{row.access.permitted ? 'Available' : 'Locked'}</Badge> },
          { key: 'since', header: 'Since', visibility: 'card-only', cell: (row) => row.since ?? '—' },
        ]}
      />
    </AppPage>
  );
}
