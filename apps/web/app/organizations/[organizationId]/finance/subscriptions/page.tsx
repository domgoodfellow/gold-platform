import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { NewSubscriptionSheet } from '@/features/finance/subscriptions/subscription-forms';
import { loadSubscriptionOptions, loadSubscriptions } from '@/lib/application/finance/subscriptions';
import { SUBSCRIPTION_STATUS_LABEL, todayIso } from '@/lib/domain/subscriptions/subscriptions';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Finance → Subscriptions (ADR-057): every recurring agreement this business keeps with its own
 * customers. Offered to members holding `subscription.read`; the database answers to that
 * permission in this business alone. GildOps' plans are subscriptions here like any other.
 */
export default async function SubscriptionsPage({ params }: PageProps<'/organizations/[organizationId]/finance/subscriptions'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'finance-subscriptions');
  const mayManage = organization.capabilities.includes('subscription.manage');
  const [rows, items] = await Promise.all([
    loadSubscriptions(db, { organizationId }),
    mayManage ? loadSubscriptionOptions(db, { organizationId }) : Promise.resolve([]),
  ]);
  const href = (subscriptionId: string) => `/organizations/${organizationId}/finance/subscriptions/${subscriptionId}`;
  const interval = { month: 'month', year: 'year' } as const;

  return (
    <AppPage>
      <PageHeader
        title="Subscriptions"
        crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]}
        actions={mayManage && items.length ? <NewSubscriptionSheet organizationId={organizationId} currency={organization.currency ?? ''} items={items} today={todayIso()} /> : undefined}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.subscription.id}
        empty={items.length || !mayManage ? 'No customer subscribes yet.' : 'No customer subscribes yet. Add a recurring item in Catalog & Pricing to sell one.'}
        columns={[
          { key: 'customer', header: 'Customer', emphasis: 'primary', cell: (row) => <Link href={href(row.subscription.id)} className="font-medium underline-offset-4 hover:underline">{row.customer.name}</Link> },
          { key: 'item', header: 'For', cell: (row) => (row.itemName ? `${row.itemName}${row.addonCount ? ` + ${row.addonCount} add-on${row.addonCount === 1 ? '' : 's'}` : ''}` : '—') },
          { key: 'price', header: 'Price', numeric: true, cell: (row) => (row.amount ? <>{formatMoney(row.amount.amountMinor, row.amount.currency)}<span className="text-muted-foreground"> / {interval[row.subscription.billingInterval]}{row.agreed ? ' · agreed' : ''}</span></> : '—') },
          { key: 'status', header: 'Status', cell: (row) => <Badge tone={row.status === 'active' ? 'success' : row.status === 'ended' ? 'neutral' : 'accent'}>{SUBSCRIPTION_STATUS_LABEL[row.status]}</Badge> },
          { key: 'billing', header: 'Invoiced by', visibility: 'card-only', cell: (row) => (row.subscription.collection === 'provider' ? 'Stripe' : 'Finance') },
          { key: 'since', header: 'Since', visibility: 'card-only', cell: (row) => row.subscription.startsOn },
        ]}
      />
    </AppPage>
  );
}
