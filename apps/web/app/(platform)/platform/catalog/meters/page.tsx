import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listMeterUsageObservations, listMeters, listProviderRates, listRetailRates } from '@/lib/domain/commercial/catalogue';

export default async function MetersPage() {
  const db = await getDb();
  const [meters, providerRates, retailRates, observations] = await Promise.all([listMeters(db), listProviderRates(db), listRetailRates(db), listMeterUsageObservations(db)]);
  return <AppPage><PageHeader title="Meters" description="Stable usage vocabulary. Meter keys are identifiers and remain migration-managed; rates change independently in Pricing." /><div><DataTable rows={meters} rowKey={(meter) => meter.id} empty="No platform meters recorded." columns={[{ key: 'meter', header: 'Meter', emphasis: 'primary', cell: (meter) => <div><span className="font-medium">{meter.id}</span><span className="block max-w-md text-xs text-muted-foreground">{meter.description}</span></div> }, { key: 'unit', header: 'Unit', cell: (meter) => meter.unit }, { key: 'providers', header: 'Provider costs', cell: (meter) => { const providers = new Set(providerRates.filter((rate) => rate.meterId === meter.id).map((rate) => rate.providerKey)); return providers.size ? `${providers.size} provider${providers.size === 1 ? '' : 's'}` : <Link href="/platform/pricing" className="underline underline-offset-4">Unpriced</Link>; } }, { key: 'retail', header: 'Retail price', cell: (meter) => retailRates.some((rate) => rate.meterId === meter.id) ? <Badge tone="success">priced</Badge> : <Badge>missing</Badge> }, { key: 'observed', header: 'Observed usage', cell: (meter) => observations.has(meter.id) ? `${observations.get(meter.id)} events` : 'Not observed' }]} /></div></AppPage>;
}
