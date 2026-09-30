import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listPlanPrices, listPlans } from '@/lib/domain/catalogue/plans';
import { simulatePackageEconomics } from '@/lib/domain/commercial/package-economics';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { CreatePlanSheet } from '@/features/finance/plans/plan-forms';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';

const financePlansHref = (organizationId: string, path = '') => `/organizations/${organizationId}/finance/plans${path ? `/${path}` : ''}`;

/**
 * Plans & Add-ons, as a GildOps Finance capability: how GildOps packages, prices and sells the
 * Products/Modules/Features the Platform catalogue defines (D25, D43, D50). It is gated the same
 * way every other narrow Platform door is — GOLD's own organization, a live `platform_staff`
 * permission — via `requirePlatformArea`, even though the canonical page now lives under Finance
 * rather than `/platform/**`. `/platform/catalog/plans/**` survives only as a redirect.
 */
export default async function FinancePlansPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/plans'> & { searchParams: Search }) {
  const { organizationId } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  const query = await searchParams;
  const db = await getDb();
  const plans = await listPlans(db);
  const rows = await Promise.all(plans.map(async (plan) => {
    const prices = await listPlanPrices(db, plan.id);
    const currentPrice = prices.find((price) => price.approvalState === 'approved');
    const economics = plan.kind === 'plan' && plan.saleStatus !== 'archived'
      ? await simulatePackageEconomics(db, { source: { type: 'plan_default', id: plan.id }, profile: 'expected' }).then((value) => value.result).catch(() => null)
      : null;
    return { plan, currentPrice, economics };
  }));
  const filtered = rows.filter(({ plan, currentPrice }) =>
    (!one(query.q) || `${plan.label} ${plan.key}`.toLowerCase().includes(one(query.q).toLowerCase())) &&
    (!one(query.kind) || plan.kind === one(query.kind)) &&
    (!one(query.sale) || plan.saleStatus === one(query.sale)) &&
    (!one(query.currency) || currentPrice?.currency === one(query.currency)));
  const filters = Boolean(one(query.q) || one(query.kind) || one(query.sale) || one(query.currency));
  return <AppPage>
    <PageHeader title="Plans & Add-ons" crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]} actions={<CreatePlanSheet />} />
    <form className="flex flex-wrap gap-2" role="search"><TextInput name="q" defaultValue={one(query.q)} placeholder="Search plans" aria-label="Search plans" size="small" /><SelectInput name="kind" defaultValue={one(query.kind)} aria-label="Type" size="small"><option value="">All types</option><option value="plan">Plans</option><option value="addon">Add-ons</option></SelectInput><SelectInput name="sale" defaultValue={one(query.sale)} aria-label="Sale state" size="small"><option value="">All sale states</option><option value="active">Active</option><option value="unlisted">Unlisted</option><option value="archived">Archived</option></SelectInput><TextInput name="currency" defaultValue={one(query.currency)} placeholder="Currency" aria-label="Currency" size="small" className="w-28" /><Button type="submit" tone="secondary" size="small">Filter</Button>{filters ? <ButtonLink href={financePlansHref(organizationId)} tone="text" size="small">Clear</ButtonLink> : null}</form>
    <div className="mt-5"><DataTable rows={filtered} rowKey={(row) => row.plan.id} empty="No Plans or Add-ons match these filters." columns={[
      { key: 'name', header: 'Name', emphasis: 'primary', cell: (row) => <div><Link href={financePlansHref(organizationId, row.plan.key)} className="font-medium underline-offset-4 hover:underline">{row.plan.label}</Link><span className="block text-xs text-muted">{row.plan.saleStatus}</span></div> },
      { key: 'type', header: 'Type', cell: (row) => row.plan.kind === 'addon' ? 'Add-on' : 'Plan' },
      { key: 'price', header: 'Current price', numeric: true, cell: (row) => row.currentPrice ? `${formatMoney(row.currentPrice.amountMinor, row.currentPrice.currency)} / ${row.currentPrice.billingInterval.replace('_',' ')}` : 'Contact sales' },
      { key: 'economics', header: 'Expected economics', numeric: true, cell: (row) => row.economics?.grossMargin === null || !row.economics ? 'Incomplete' : `${(row.economics.grossMargin * 100).toFixed(1)}% margin` },
    ]} /></div>
  </AppPage>;
}
