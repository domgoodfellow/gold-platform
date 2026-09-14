import { AppPage } from '@/components/containers/app-page';
import { PageChromeRegistrar } from '@/components/containers/workspace-page-chrome';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listProviderRates, listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderBindingCounts } from '@/lib/domain/providers/bindings';

function adapterState(key: string): 'configured' | 'not configured' | 'not implemented' {
  if (key === 'twilio') return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? 'configured' : 'not configured';
  if (key === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured';
  if (key === 'resend') return process.env.RESEND_API_KEY ? 'configured' : 'not configured';
  return 'not implemented';
}

export default async function ProvidersPage() {
  const db = await getDb();
  const [providers, rates, bindingCounts] = await Promise.all([listProviders(db), listProviderRates(db), listProviderBindingCounts(db)]);
  return <AppPage width="full"><PageChromeRegistrar title="Providers" crumbs={[{ label: 'Infrastructure' }]} /><p className="max-w-3xl text-sm text-muted-foreground">Global provider vocabulary, adapter readiness, cost coverage, and tenant binding counts. Credentials are never read or displayed here.</p><div className="mt-6"><DataTable rows={providers} rowKey={(provider) => provider.key} empty="No providers recorded." columns={[{ key: 'provider', header: 'Provider', emphasis: 'primary', cell: (provider) => <div><span className="font-medium">{provider.label}</span><span className="block text-xs text-muted-foreground">{provider.key}</span></div> }, { key: 'adapter', header: 'Platform adapter', cell: (provider) => { const state = adapterState(provider.key); return <Badge tone={state === 'configured' ? 'success' : 'neutral'}>{state}</Badge>; } }, { key: 'meters', header: 'Costed meters', cell: (provider) => { const meters = [...new Set(rates.filter((rate) => rate.providerKey === provider.key).map((rate) => rate.meterId))]; return meters.length ? meters.join(', ') : 'No wholesale rates'; } }, { key: 'bindings', header: 'Tenant bindings', numeric: true, cell: (provider) => bindingCounts.get(provider.key) ?? 0 }]} /></div></AppPage>;
}
