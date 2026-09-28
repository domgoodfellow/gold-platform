import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listProviderSyncFailures } from '@/lib/domain/commercial/usage';
import { listFailures, listTenants } from '@/lib/domain/platform/tenants';

export default async function FailuresPage({ params }: PageProps<'/organizations/[organizationId]/platform/failures'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.health');
  const db = await getDb();
  const [{ tenants }, failures, syncFailures] = await Promise.all([listTenants(db), listFailures(db), listProviderSyncFailures(db)]);
  const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const organizationLink = (id: string | null) => id ? <Link href={platformHref(goldId, `organizations/${id}/failures`)} className="underline underline-offset-4">{names.get(id) ?? id}</Link> : 'Platform-wide';
  return <AppPage><PageHeader title="Failures" crumbs={platformAncestry(goldId, 'failures')} description="Actionable operational and provider-reconciliation failures across GildOps." /><section><SectionHeading>Operational failures</SectionHeading><div className="mt-3"><DataTable rows={failures} rowKey={(row) => `${row.organizationId}-${row.occurredAt}-${row.subject}`} empty="No operational failures recorded." columns={[{ key: 'organization', header: 'Organization', emphasis: 'primary', cell: (row) => organizationLink(row.organizationId) }, { key: 'kind', header: 'Kind', cell: (row) => row.kind }, { key: 'subject', header: 'Subject', cell: (row) => row.subject || '—' }, { key: 'occurred', header: 'Occurred', cell: (row) => new Date(row.occurredAt).toLocaleString() }, { key: 'detail', header: 'Detail', emphasis: 'secondary', cell: (row) => row.detail || '—' }]} /></div></section><section className="mt-10"><SectionHeading>Provider reconciliation failures</SectionHeading><div className="mt-3"><DataTable rows={syncFailures} rowKey={(row) => row.id} empty="No provider reconciliation failures recorded." columns={[{ key: 'organization', header: 'Organization', emphasis: 'primary', cell: (row) => organizationLink(row.organizationId) }, { key: 'meter', header: 'Meter', cell: (row) => row.meterId ?? '—' }, { key: 'occurred', header: 'Occurred', cell: (row) => new Date(row.occurredAt).toLocaleString() }, { key: 'detail', header: 'Detail', cell: (row) => row.detail }]} /></div></section></AppPage>;
}
