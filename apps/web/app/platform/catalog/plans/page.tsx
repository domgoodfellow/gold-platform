import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listPlans } from '@/lib/domain/catalogue/plans';
import { CreatePlanSheet } from '@/features/platform/plans/plan-forms';
import { platformParams, requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';

export const dynamic = 'force-dynamic';
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';

/**
 * Product Registry → Plans (ADR-057): what each plan and add-on switches on. How each is priced and
 * sold is the recurring item in GildOps' Finance that sells it.
 */
export default async function PlatformPlansPage({ params, searchParams }: PageProps<'/platform/catalog/plans'> & { searchParams: Search }) {
  const { organizationId } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.catalogue');
  const query = await searchParams;
  const plans = await listPlans(await getDb());
  const filtered = plans.filter((plan) =>
    (!one(query.q) || `${plan.label} ${plan.key}`.toLowerCase().includes(one(query.q).toLowerCase())) &&
    (!one(query.kind) || plan.kind === one(query.kind)));
  const filters = Boolean(one(query.q) || one(query.kind));
  const href = (path = '') => platformHref(organizationId, `catalog/plans${path ? `/${path}` : ''}`);
  return <AppPage>
    <PageHeader title="Plans" crumbs={platformAncestry(organizationId, 'plans')} actions={<CreatePlanSheet />} />
    <form className="flex flex-wrap gap-2" role="search">
      <TextInput name="q" defaultValue={one(query.q)} placeholder="Search plans" aria-label="Search plans" size="small" />
      <SelectField name="kind" defaultValue={one(query.kind)} aria-label="Type" size="small" options={[{ value: '', label: 'All types' }, { value: 'plan', label: 'Plans' }, { value: 'addon', label: 'Add-ons' }]} />
      <Button type="submit" tone="secondary" size="small">Filter</Button>
      {filters ? <ButtonLink href={href()} tone="text" size="small">Clear</ButtonLink> : null}
    </form>
    <div className="mt-5"><DataTable rows={filtered} rowKey={(plan) => plan.id} empty="No plans or add-ons match these filters." columns={[
      { key: 'name', header: 'Name', emphasis: 'primary', cell: (plan) => <Link href={href(plan.key)} className="font-medium underline-offset-4 hover:underline">{plan.label}</Link> },
      { key: 'key', header: 'Key', cell: (plan) => <span className="font-mono text-xs">{plan.key}</span> },
      { key: 'type', header: 'Type', cell: (plan) => plan.kind === 'addon' ? 'Add-on' : 'Plan' },
      { key: 'billing', header: 'Billing', cell: (plan) => plan.billable ? 'Billed' : <Badge>Not billed</Badge> },
      { key: 'sale', header: 'Offered', cell: (plan) => plan.saleStatus === 'active' ? 'Offered' : <Badge>{plan.saleStatus === 'unlisted' ? 'Not offered' : 'Retired'}</Badge> },
    ]} /></div>
  </AppPage>;
}
