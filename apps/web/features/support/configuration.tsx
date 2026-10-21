import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { readSupportConfiguration, type SupportConfiguration } from '@/lib/domain/support/support';
import { ConfigurationEditor } from './editors';
import { PageHeader } from '@/components/headers/page-header';
import { AppPage } from '@/components/layout/app-page';
import { EmptyState } from '@/components/surfaces/section';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';

export type SupportConfigurationKind = 'queue' | 'policy';

const DESCRIPTIONS: Record<SupportConfigurationKind, string> = {
 queue: 'Queues group cases by responsibility. Case assignment remains on each case; automatic assignment policies are unavailable.',
 policy: 'Elapsed-time resolution targets. Queue-specific policies take precedence over the priority fallback. Business-time and first-response targets are unavailable.',
};

/** One kind's records, each with its own editor. Shared by the configuration page and the Configure panel. */
function SupportRecords({ organizationId, data, kind }: { organizationId: string; data: SupportConfiguration; kind: SupportConfigurationKind }) {
 const records = kind === 'queue' ? data.queues : data.policies;
 if (!records.length) return <EmptyState className="mt-6">{kind === 'queue' ? 'No queues configured. Cases may remain unqueued.' : 'No service levels configured. Cases without a matching policy have no target.'}</EmptyState>;
 return <ul className="mt-6 divide-y divide-border">{records.map(record => <li id={`${kind}-${record.id}`} key={record.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{record.name}</p><p className="text-sm text-muted">{record.active ? 'Active' : 'Inactive'}{'target_minutes' in record ? ` · ${record.priority} · ${record.target_minutes} min` : ` · ${record.description}`}</p></div><ConfigurationEditor organizationId={organizationId} data={data} kind={kind} queue={kind === 'queue' ? data.queues.find(item => item.id === record.id) : undefined} policy={kind === 'policy' ? data.policies.find(item => item.id === record.id) : undefined} /></li>)}</ul>;
}

export async function SupportConfigurationPage({ organizationId, kind }: { organizationId: string; kind: SupportConfigurationKind }) {
 const key = kind === 'queue' ? 'support-queues' : 'support-service-levels';
 const { db, gate } = await requireConfigurationTarget(organizationId, key);
 const data = await readSupportConfiguration(db, organizationId);
 return <AppPage><PageHeader title={kind === 'queue' ? 'Queues & assignment' : 'Service levels'} crumbs={workspaceConfigCrumbs(organizationId, key, gate)} actions={<ConfigurationEditor organizationId={organizationId} data={data} kind={kind} />} />
 <p className="text-sm text-muted">{DESCRIPTIONS[kind]}</p>
 <SupportRecords organizationId={organizationId} data={data} kind={kind} />
 </AppPage>;
}

/** The Configure panel: each configuration concern the member may edit, with its own New control and records. */
export function SupportConfigurePanel({ organizationId, data, kinds }: { organizationId: string; data: SupportConfiguration; kinds: readonly SupportConfigurationKind[] }) {
 return <div className="space-y-8 p-4">{kinds.map(kind => <section key={kind} aria-labelledby={`support-configure-${kind}`}>
  <div className="flex items-center justify-between gap-2">
   <h2 id={`support-configure-${kind}`} className="text-sm font-semibold">{kind === 'queue' ? 'Queues' : 'Service levels'}</h2>
   <ConfigurationEditor organizationId={organizationId} data={data} kind={kind} />
  </div>
  <p className="mt-1 text-sm text-muted">{DESCRIPTIONS[kind]}</p>
  <SupportRecords organizationId={organizationId} data={data} kind={kind} />
 </section>)}</div>;
}
