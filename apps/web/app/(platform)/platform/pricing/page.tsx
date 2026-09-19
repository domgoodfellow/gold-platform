import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { Card, CardContent, CardHeader, CardTitle } from '@gold/ui/components/card';
import { getDb } from '@/lib/db/server';
import { listPlans, listPlanPrices, listPlanQuotas } from '@/lib/domain/catalogue/plans';
import { listMeters, listProductPrices, listProducts, listProviderRates, listProviders, listRetailRates, microsToMinor } from '@/lib/domain/commercial/catalogue';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const money = (amount: number, currency: string) => formatMoney(amount, currency);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const units: Record<string, string> = { minute: 'min', segment: 'segment', second: 'sec', character: 'character', send: 'send', token: 'token' };
function displayRate(micros: number, currency: string, unit: string) { return `${money(microsToMinor(micros), currency)} / ${units[unit] ?? unit}`; }

export default async function PricingPage() {
  const db = await getDb();
  const [plans, providerRates, retailRates, meters, providers, products, productPrices, communications, costs] = await Promise.all([
    listPlans(db), listProviderRates(db), listRetailRates(db), listMeters(db), listProviders(db), listProducts(db), listProductPrices(db),
    db.from('communication_rates').select('currency, channel, unit_amount_minor, updated_at'),
    db.from('platform_plan_cost_assumptions').select('plan_id, currency, provider_cost_minor, labour_cost_minor'),
  ]);
  if (communications.error) throw new Error(communications.error.message);
  if (costs.error) throw new Error(costs.error.message);
  const prices = new Map(await Promise.all(plans.map(async (plan) => [plan.id, await listPlanPrices(db, plan.id)] as const)));
  const quotas = new Map(await Promise.all(plans.map(async (plan) => [plan.id, await listPlanQuotas(db, plan.id)] as const)));
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const providerByKey = new Map(providers.map((provider) => [provider.key, provider.label]));
  const costByPlan = new Map((costs.data ?? []).map((cost) => [cost.plan_id, cost]));
  const sellable = plans.filter((plan) => plan.billable);
  const offers = sellable.map((plan) => {
    const allPrices = prices.get(plan.id) ?? [];
    const monthly = allPrices.find((price) => price.billingInterval === 'month');
    const annual = allPrices.find((price) => price.billingInterval === 'year' || price.billingInterval === 'one_time');
    const cost = costByPlan.get(plan.id);
    return { plan, monthly, annual, cost, allowance: (quotas.get(plan.id) ?? []).map((q) => `${q.includedQuantity.toLocaleString()} ${q.label.toLowerCase()}`).join(' · ') || '—', contribution: monthly && cost ? (monthly.amountMinor - cost.provider_cost_minor - cost.labour_cost_minor) / monthly.amountMinor : null };
  });
  const usage = [
    ...(communications.data ?? []).map((r) => ({ id: `communication-${r.currency}-${r.channel}`, capability: r.channel === 'voice' ? 'Voice' : r.channel.toUpperCase(), price: `${money(r.unit_amount_minor, r.currency)} / ${r.channel === 'voice' ? 'minute' : 'segment'}`, currency: r.currency, source: 'Communication rates', effective: r.updated_at })),
    ...retailRates.map((r) => ({ id: r.id, capability: meterById.get(r.meterId)?.description ?? r.meterId, price: displayRate(r.unitAmountMicros, r.currency, meterById.get(r.meterId)?.unit ?? 'unit'), currency: r.currency, source: r.source, effective: r.effectiveFrom })),
  ];
  const internal = plans.find((plan) => plan.key === 'gold_internal');
  return <AppPage width="full"><PageHeader title="Pricing" description="GOLD&apos;s launch commercial console. Plans and Add-ons are the primary offer model; the legacy rate card remains for compatibility." />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Sellable Plans', sellable.length], ['Priced Plans', offers.filter((o) => o.monthly || o.annual).length], ['Active usage rates', usage.length], ['Provider cost coverage', `${new Set(providerRates.map((r) => r.meterId)).size}/${meters.length}`]].map(([label, value]) => <Card key={String(label)}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{value}</CardContent></Card>)}</div>
    <section className="mt-10"><h2 className="text-lg font-semibold">Plans &amp; offers</h2><p className="mt-1 text-sm text-muted-foreground">Package prices, included allowances, and monthly planning economics.</p><div className="mt-4"><DataTable rows={offers} rowKey={(r) => r.plan.id} empty="No canonical Plans or Add-ons recorded." columns={[
      { key: 'offer', header: 'Offer', emphasis: 'primary', cell: (r) => <div><Link className="font-medium underline-offset-4 hover:underline" href={`/platform/catalog/plans/${r.plan.key}`}>{r.plan.label}</Link><span className="block text-xs text-muted-foreground">{r.plan.kind === 'addon' ? 'Add-on' : 'Base plan'}</span></div> },
      { key: 'monthly', header: 'Monthly', cell: (r) => r.monthly ? money(r.monthly.amountMinor, r.monthly.currency) : '—' }, { key: 'annual', header: 'Annual / one-time', cell: (r) => r.annual ? money(r.annual.amountMinor, r.annual.currency) : '—' },
      { key: 'allowance', header: 'Included allowances', cell: (r) => <span className="max-w-xs text-xs">{r.allowance}</span> }, { key: 'cogs', header: 'Provider COGS', cell: (r) => r.cost ? money(r.cost.provider_cost_minor, r.cost.currency) : '—' }, { key: 'margin', header: 'Contribution margin', cell: (r) => r.contribution === null ? '—' : pct(r.contribution) }, { key: 'status', header: 'Sale status', cell: (r) => <Badge tone={r.plan.saleStatus === 'active' ? 'success' : 'neutral'}>{r.plan.saleStatus}</Badge> },
    ]} /></div>{internal ? <p className="mt-3 text-xs text-muted-foreground">Internal / non-billable: <Link className="underline" href={`/platform/catalog/plans/${internal.key}`}>{internal.label}</Link></p> : null}</section>
    <section className="mt-10"><h2 className="text-lg font-semibold">Usage rates</h2><div className="mt-4"><DataTable rows={usage} rowKey={(r) => r.id} empty="No usage rates recorded." columns={[{ key: 'capability', header: 'Capability', emphasis: 'primary', cell: (r) => r.capability }, { key: 'price', header: 'Customer price', cell: (r) => r.price }, { key: 'currency', header: 'Currency', cell: (r) => r.currency }, { key: 'source', header: 'Source of truth', cell: (r) => r.source }, { key: 'effective', header: 'Effective', cell: (r) => new Date(r.effective).toLocaleDateString() }]} /></div></section>
    <section className="mt-10"><h2 className="text-lg font-semibold">Provider costs</h2><div className="mt-4"><DataTable rows={providerRates} rowKey={(r) => r.id} empty="No provider costs recorded." columns={[{ key: 'provider', header: 'Provider', emphasis: 'primary', cell: (r) => providerByKey.get(r.providerKey ?? '') ?? r.providerKey }, { key: 'capability', header: 'Capability', cell: (r) => meterById.get(r.meterId)?.description ?? r.meterId }, { key: 'cost', header: 'Cost', cell: (r) => displayRate(r.unitAmountMicros, r.currency, meterById.get(r.meterId)?.unit ?? 'unit') }, { key: 'approval', header: 'Approval', cell: (r) => <Badge tone={r.approvalState === 'approved' ? 'success' : 'neutral'}>{r.approvalState}</Badge> }, { key: 'source', header: 'Source', cell: (r) => r.source }, { key: 'captured', header: 'Captured', cell: (r) => new Date(r.capturedAt).toLocaleDateString() }]} /></div></section>
    <section className="mt-10"><h2 className="text-lg font-semibold">Legacy line-item rate card</h2><p className="mt-1 text-sm text-muted-foreground">Compatibility-only module and seat SKUs, not the package pricing model.</p><div className="mt-4"><DataTable rows={productPrices} rowKey={(r) => r.id} empty="No legacy line-item rates recorded." columns={[{ key: 'product', header: 'Line item', emphasis: 'primary', cell: (r) => products.find((p) => p.key === r.productKey)?.label ?? r.productKey }, { key: 'price', header: 'Price', cell: (r) => money(r.amountMinor, r.currency) }, { key: 'cadence', header: 'Cadence', cell: (r) => r.billingInterval.replace('_', ' ') }, { key: 'effective', header: 'Effective', cell: (r) => new Date(r.effectiveFrom).toLocaleDateString() }]} /></div></section>
  </AppPage>;
}
