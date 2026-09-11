import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeading, SectionHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listProviderSyncFailures } from '@/lib/domain/commercial/usage';
import { listFailures, listTenants } from '@/lib/domain/platform/tenants';

export default async function FailuresPage() {
  const db = await getDb();
  const [{ tenants }, failures, syncFailures] = await Promise.all([listTenants(db), listFailures(db), listProviderSyncFailures(db)]);
  const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const organizationLink = (id: string | null) => id ? <Link href={`/platform/organizations/${id}/failures`} className="underline underline-offset-4">{names.get(id) ?? id}</Link> : 'Platform-wide';
  return <AppPage width="full"><PageHeading>Failures</PageHeading><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Actionable operational and provider-reconciliation failures across GOLD.</p><section className="mt-8"><SectionHeading>Operational failures</SectionHeading><div className="mt-3"><DataTable rows={failures} rowKey={(row) => `${row.organizationId}-${row.occurredAt}-${row.subject}`} empty="No operational failures recorded." columns={[{ key: 'organization', header: 'Organization', emphasis: 'primary', cell: (row) => organizationLink(row.organizationId) }, { key: 'kind', header: 'Kind', cell: (row) => row.kind }, { key: 'subject', header: 'Subject', cell: (row) => row.subject || '—' }, { key: 'occurred', header: 'Occurred', cell: (row) => new Date(row.occurredAt).toLocaleString() }, { key: 'detail', header: 'Detail', emphasis: 'secondary', cell: (row) => row.detail || '—' }]} /></div></section><section className="mt-10"><SectionHeading>Provider reconciliation failures</SectionHeading><div className="mt-3"><DataTable rows={syncFailures} rowKey={(row) => row.id} empty="No provider reconciliation failures recorded." columns={[{ key: 'organization', header: 'Organization', emphasis: 'primary', cell: (row) => organizationLink(row.organizationId) }, { key: 'meter', header: 'Meter', cell: (row) => row.meterId ?? '—' }, { key: 'occurred', header: 'Occurred', cell: (row) => new Date(row.occurredAt).toLocaleString() }, { key: 'detail', header: 'Detail', cell: (row) => row.detail }]} /></div></section></AppPage>;
}
