import { platformParams } from '@/lib/route/platform';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listPlanPrices, listPlans } from '@/lib/domain/catalogue/plans';
import { simulatePackageEconomics } from '@/lib/domain/commercial/package-economics';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { CreatePlanSheet } from '@/features/platform/plans/plan-forms';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry } from '@/lib/platform-navigation';
import { SelectField } from '@/components/controls/select-field';

export const dynamic = 'force-dynamic';
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';

const plansHref = (organizationId: string, path = '') => `/platform/plans${path ? `/${path}` : ''}`;

/**
 * Plans & Add-ons: how GildOps packages, prices and sells the Products/Modules/Features the catalogue
 * defines. GildOps' own commercial control plane — what a business buys from
 * GildOps — and never tenant Financial Operations. Gated by `requirePlatformArea` on a live
 * `platform_staff` permission.
 */
export default async function PlatformPlansPage({ params, searchParams }: PageProps<'/platform/plans'> & { searchParams: Search }) {
  const { organizationId } = await platformParams(params);
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
    <PageHeader title="Plans & Add-ons" crumbs={platformAncestry(organizationId, 'plans')} actions={<CreatePlanSheet />} />
    <form className="flex flex-wrap gap-2" role="search"><TextInput name="q" defaultValue={one(query.q)} placeholder="Search plans" aria-label="Search plans" size="small" /><SelectField name="kind" defaultValue={one(query.kind)} aria-label="Type" size="small" options={[{ value: '', label: 'All types' }, { value: 'plan', label: 'Plans' }, { value: 'addon', label: 'Add-ons' }]} /><SelectField name="sale" defaultValue={one(query.sale)} aria-label="Sale state" size="small" options={[{ value: '', label: 'All sale states' }, { value: 'active', label: 'Active' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'archived', label: 'Archived' }]} /><TextInput name="currency" defaultValue={one(query.currency)} placeholder="Currency" aria-label="Currency" size="small" className="w-28" /><Button type="submit" tone="secondary" size="small">Filter</Button>{filters ? <ButtonLink href={plansHref(organizationId)} tone="text" size="small">Clear</ButtonLink> : null}</form>
    <div className="mt-5"><DataTable rows={filtered} rowKey={(row) => row.plan.id} empty="No Plans or Add-ons match these filters." columns={[
      { key: 'name', header: 'Name', emphasis: 'primary', cell: (row) => <div><Link href={plansHref(organizationId, row.plan.key)} className="font-medium underline-offset-4 hover:underline">{row.plan.label}</Link><span className="block text-xs text-muted">{row.plan.saleStatus}</span></div> },
      { key: 'type', header: 'Type', cell: (row) => row.plan.kind === 'addon' ? 'Add-on' : 'Plan' },
      { key: 'price', header: 'Current price', numeric: true, cell: (row) => row.currentPrice ? `${formatMoney(row.currentPrice.amountMinor, row.currentPrice.currency)} / ${row.currentPrice.billingInterval.replace('_',' ')}` : 'Contact sales' },
      { key: 'economics', header: 'Expected economics', numeric: true, cell: (row) => row.economics?.grossMargin === null || !row.economics ? 'Incomplete' : `${(row.economics.grossMargin * 100).toFixed(1)}% margin` },
    ]} /></div>
  </AppPage>;
}
