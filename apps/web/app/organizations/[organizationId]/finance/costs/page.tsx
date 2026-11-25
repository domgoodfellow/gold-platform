import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { DataTable } from '@/components/display/table';
import { ViewNav } from '@/components/navigation/view-nav';
import { AddSupplierRate, SupplierRateDrawer } from '@/features/finance/costs/supplier-rates';
import { UsageEventDrawer } from '@/features/finance/costs/usage-cost-drawer';
import { RecordCostComponent } from '@/features/finance/costs/cost-components';
import { ALLOCATION_QUALITY_LABEL, COST_CATEGORY_LABEL } from '@/features/finance/costs/cost-labels';
import { Badge } from '@/components/display/data';
import { listInfrastructureCosts } from '@/lib/domain/commercial/infrastructure-costs';
import { listMeters, listProviderCostMeters, listProviderCostRates, listProviders, type ProviderCostRate } from '@/lib/domain/commercial/catalogue';
import { formatMicrosMoney, formatUsage, listCostComponents, listEconomicsEvents, type CostState } from '@/lib/domain/commercial/economics';
import { listTenants } from '@/lib/domain/platform/tenants';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

const sameScope = (left: ProviderCostRate, right: ProviderCostRate) =>
  left.id !== right.id && left.providerKey === right.providerKey && left.costMeterKey === right.costMeterKey &&
  left.region === right.region && left.direction === right.direction && left.resourceType === right.resourceType;
const overlaps = (left: ProviderCostRate, right: ProviderCostRate) =>
  (!left.effectiveTo || new Date(right.effectiveFrom) < new Date(left.effectiveTo)) &&
  (!right.effectiveTo || new Date(left.effectiveFrom) < new Date(right.effectiveTo));

/**
 * Finance → Costs (ADR-057): what suppliers charge per unit of usage, what each unit of usage
 * actually cost, and the month's infrastructure and other direct costs. Offered by the operator Product to members holding `cost.read`; recording a rate
 * takes `cost.manage`. The database answers only to those permissions in GildOps' own organization.
 */
export default async function CostsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/costs'> & { searchParams: Search }) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'finance-costs');
  const query = await searchParams;
  const view = one(query.view) === 'usage' ? 'usage' : one(query.view) === 'infrastructure' ? 'infrastructure' : 'rates';
  const base = `/organizations/${organizationId}/finance/costs`;
  const mayManage = organization.capabilities.includes('cost.manage');
  const [providers, meters, costMeters] = await Promise.all([listProviders(db), listMeters(db), listProviderCostMeters(db)]);

  const header = (
    <>
      <PageHeader
        title="Costs"
        crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]}
        actions={view === 'rates' && mayManage ? <AddSupplierRate organizationId={organizationId} providers={providers} meters={meters} costMeters={costMeters} /> : view === 'infrastructure' && mayManage ? <RecordCostComponent organizationId={organizationId} businesses={(await listTenants(db)).tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))} suppliers={providers.map((provider) => ({ value: provider.key, label: provider.label }))} currency={organization.currency || 'CAD'} /> : undefined}
      />
      <ViewNav label="Costs" current={view} views={[
        { key: 'rates', label: 'Supplier rates', href: base },
        { key: 'usage', label: 'Usage costs', href: `${base}?view=usage` },
        { key: 'infrastructure', label: 'Infrastructure', href: `${base}?view=infrastructure` },
      ]} />
    </>
  );

  if (view === 'rates') {
    const providerKey = one(query.provider);
    const costMeterKey = one(query.meter);
    const region = one(query.region);
    const search = one(query.q);
    const currentOnly = one(query.current) !== 'all';
    const [rates, allRates] = await Promise.all([
      listProviderCostRates(db, { providerKey: providerKey || undefined, costMeterKey: costMeterKey || undefined, region: region || undefined, currentOnly }),
      listProviderCostRates(db),
    ]);
    const providerLabel = new Map(providers.map((provider) => [provider.key, provider.label]));
    const costMeterByKey = new Map(costMeters.map((meter) => [meter.key, meter]));
    const shown = rates.filter((rate) => !search || `${rate.costMeterKey} ${rate.source}`.toLowerCase().includes(search.toLowerCase()));
    const filtered = Boolean(providerKey || costMeterKey || region || search || !currentOnly);
    return (
      <AppPage>
        {header}
        <form className="flex flex-wrap gap-2" role="search">
          <TextInput name="q" defaultValue={search} placeholder="Search rates" aria-label="Search rates" size="small" />
          <SelectField name="provider" defaultValue={providerKey} aria-label="Supplier" size="small" options={[{ value: '', label: 'All suppliers' }, ...providers.map((provider) => ({ value: provider.key, label: provider.label }))]} />
          <SelectField name="meter" defaultValue={costMeterKey} aria-label="Service" size="small" options={[{ value: '', label: 'All services' }, ...costMeters.map((meter) => ({ value: meter.key, label: meter.label }))]} />
          <TextInput name="region" defaultValue={region} placeholder="Country / region" aria-label="Country or region" size="small" className="w-36" />
          <SelectField name="current" defaultValue={currentOnly ? 'current' : 'all'} aria-label="Effective state" size="small" options={[{ value: 'current', label: 'Current only' }, { value: 'all', label: 'All history' }]} />
          <Button type="submit" tone="secondary" size="small">Filter</Button>
          {filtered ? <ButtonLink href={base} tone="text" size="small">Clear</ButtonLink> : null}
        </form>
        <div>
          <DataTable rows={shown} rowKey={(rate) => rate.id} empty="No supplier rates recorded." columns={[
            { key: 'provider', header: 'Supplier', cell: (rate) => providerLabel.get(rate.providerKey ?? '') ?? rate.providerKey },
            { key: 'meter', header: 'Service', emphasis: 'primary', cell: (rate) => <SupplierRateDrawer rate={rate} history={allRates.filter((item) => item.providerKey === rate.providerKey && item.costMeterKey === rate.costMeterKey && item.region === rate.region)} label={costMeterByKey.get(rate.costMeterKey)?.label ?? rate.costMeterKey} /> },
            { key: 'region', header: 'Region', cell: (rate) => rate.region ?? 'Global' },
            { key: 'rate', header: 'Rate', numeric: true, cell: (rate) => `${formatMicrosMoney(rate.unitAmountMicros, rate.currency, 4)} / ${costMeterByKey.get(rate.costMeterKey)?.unit ?? 'unit'}` },
            { key: 'effective', header: 'From', cell: (rate) => new Date(rate.effectiveFrom).toLocaleDateString() },
            { key: 'attention', header: 'Status', cell: (rate) => (allRates.some((item) => sameScope(rate, item) && overlaps(rate, item)) ? 'Overlaps another rate' : 'OK') },
            { key: 'source', header: 'Source', visibility: 'card-only', cell: (rate) => rate.source },
          ]} />
        </div>
      </AppPage>
    );
  }

  if (view === 'infrastructure') {
    const month = /^\d{4}-\d{2}$/.test(one(query.month)) ? one(query.month) : new Date().toISOString().slice(0, 7);
    const start = `${month}-01`;
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const [components, tenants] = await Promise.all([listInfrastructureCosts(db, { from: start, to: next.toISOString().slice(0, 10) }), listTenants(db)]);
    const tenantName = new Map(tenants.tenants.map((tenant) => [tenant.id, tenant.name]));
    return (
      <AppPage>
        {header}
        <form className="flex flex-wrap gap-2" role="search">
          <input type="hidden" name="view" value="infrastructure" />
          <TextInput type="month" name="month" defaultValue={month} aria-label="Month" size="small" />
          <Button type="submit" tone="secondary" size="small">Show</Button>
        </form>
        <div>
          <DataTable rows={components} rowKey={(row) => row.id} empty="No cost recorded for this month." columns={[
            { key: 'kind', header: 'Kind', emphasis: 'primary', cell: (row) => COST_CATEGORY_LABEL[row.costCategory] ?? row.costCategory },
            { key: 'business', header: 'Business', cell: (row) => (row.organizationId ? (tenantName.get(row.organizationId) ?? row.organizationId) : 'Shared') },
            { key: 'allocation', header: 'Allocation', cell: (row) => <Badge>{ALLOCATION_QUALITY_LABEL[row.allocationQuality] ?? row.allocationQuality}</Badge> },
            { key: 'supplier', header: 'Supplier', cell: (row) => row.providerKey ?? '—' },
            { key: 'amount', header: 'Amount', numeric: true, cell: (row) => formatMicrosMoney(row.nativeCostMicros, row.nativeCurrency) },
            { key: 'source', header: 'Source', visibility: 'card-only', cell: (row) => row.source },
          ]} />
        </div>
      </AppPage>
    );
  }

  const subscriberId = one(query.organization);
  const meterId = one(query.meter);
  const providerKey = one(query.provider);
  const state = one(query.state);
  const from = one(query.from);
  const to = one(query.to);
  const [events, tenants] = await Promise.all([
    listEconomicsEvents(db, {
      organizationId: subscriberId || undefined,
      meterId: meterId || undefined,
      providerKey: providerKey || undefined,
      costState: state ? (state as CostState) : undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    }),
    listTenants(db),
  ]);
  const components = new Map(await Promise.all(events.map(async (event) => [event.id, await listCostComponents(db, event.id)] as const)));
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const knownCost = events.reduce((sum, event) => sum + event.knownCostMicros, 0);
  const unknownCount = events.filter((event) => event.costState === 'unknown').length;
  const currencies = new Set(events.map((event) => event.reportingCurrency).filter(Boolean));
  const filtered = Boolean(subscriberId || meterId || providerKey || state || from || to);

  return (
    <AppPage>
      {header}
      <form className="flex flex-wrap gap-2" role="search">
        <input type="hidden" name="view" value="usage" />
        <TextInput type="date" name="from" defaultValue={from} aria-label="From date" size="small" />
        <TextInput type="date" name="to" defaultValue={to} aria-label="To date" size="small" />
        <SelectField name="organization" defaultValue={subscriberId} aria-label="Business" size="small" options={[{ value: '', label: 'Every business' }, ...tenants.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]} />
        <SelectField name="meter" defaultValue={meterId} aria-label="Meter" size="small" options={[{ value: '', label: 'All meters' }, ...meters.map((meter) => ({ value: meter.id, label: meter.label }))]} />
        <SelectField name="provider" defaultValue={providerKey} aria-label="Supplier" size="small" options={[{ value: '', label: 'All suppliers' }, ...providers.map((provider) => ({ value: provider.key, label: provider.label }))]} />
        <SelectField name="state" defaultValue={state} aria-label="Cost state" size="small" options={[{ value: '', label: 'All cost states' }, { value: 'reconciled', label: 'Reconciled' }, { value: 'estimated', label: 'Estimated' }, { value: 'unknown', label: 'Unknown' }]} />
        <Button type="submit" tone="secondary" size="small">Filter</Button>
        {filtered ? <ButtonLink href={`${base}?view=usage`} tone="text" size="small">Clear</ButtonLink> : null}
      </form>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Known cost</dt><dd className="font-medium tabular-nums">{currencies.size === 1 ? formatMicrosMoney(knownCost, [...currencies][0] ?? null) : currencies.size > 1 ? 'Mixed currencies' : '—'}</dd></div>
        <div><dt className="text-muted">Unknown cost</dt><dd className="font-medium tabular-nums">{unknownCount.toLocaleString()}</dd></div>
        <div><dt className="text-muted">Usage events</dt><dd className="font-medium tabular-nums">{events.length.toLocaleString()}</dd></div>
        <div><dt className="text-muted">Costed</dt><dd className="font-medium tabular-nums">{events.length ? `${Math.round(((events.length - unknownCount) / events.length) * 100)}%` : '—'}</dd></div>
      </dl>

      <div>
        <DataTable
          rows={events}
          rowKey={(event) => event.id}
          empty="No usage for this period."
          columns={[
            { key: 'organization', header: 'Business', emphasis: 'primary', cell: (event) => <UsageEventDrawer event={event} components={components.get(event.id) ?? []} meterUnit={meterById.get(event.meterId)?.unit ?? 'unit'} /> },
            { key: 'meter', header: 'Meter', cell: (event) => meterById.get(event.meterId)?.label ?? event.meterId },
            { key: 'usage', header: 'Usage', numeric: true, cell: (event) => formatUsage(event.quantity, meterById.get(event.meterId)?.unit ?? 'unit') },
            { key: 'included', header: 'Included', numeric: true, cell: (event) => (event.allowanceKey === null ? '—' : formatUsage(event.includedQuantity ?? 0, meterById.get(event.meterId)?.unit ?? 'unit')) },
            { key: 'billable', header: 'Billable', numeric: true, cell: (event) => formatUsage(event.allowanceKey === null ? event.quantity : (event.overageQuantity ?? 0), meterById.get(event.meterId)?.unit ?? 'unit') },
            { key: 'charge', header: 'Customer charge', numeric: true, cell: (event) => (event.retailState === 'priced' ? formatMicrosMoney(event.customerChargeMicros, event.customerCurrency, 4) : event.retailState === 'no_currency' ? 'No currency' : 'Unpriced') },
            { key: 'cost', header: 'Known cost', numeric: true, cell: (event) => (event.costState === 'unknown' ? (event.knownCostMicros > 0 ? `${formatMicrosMoney(event.knownCostMicros, event.reportingCurrency)} + unknown` : '—') : formatMicrosMoney(event.knownCostMicros, event.reportingCurrency)) },
            { key: 'status', header: 'Status', cell: (event) => (event.costState === 'unknown' ? 'Cost unknown' : event.costState) },
            { key: 'occurred', header: 'Occurred', visibility: 'card-only', cell: (event) => new Date(event.occurredAt).toLocaleString() },
          ]}
        />
      </div>
    </AppPage>
  );
}
