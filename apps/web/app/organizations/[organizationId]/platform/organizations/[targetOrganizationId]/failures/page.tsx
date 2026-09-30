import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { getTenant, listFailures } from '@/lib/domain/platform/tenants';
import { listProviderSyncFailures } from '@/lib/domain/commercial/usage';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';

export const dynamic = 'force-dynamic';
export default async function TenantFailures({ params }: PageProps<'/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/failures'>) {
  const { organizationId: goldId, targetOrganizationId: organizationId } = await params;
  await requirePlatformArea(goldId, 'platform.organizations'); const db = await getDb(); const tenant = await getTenant(db, organizationId); if (!tenant) redirect(platformHref(goldId, 'organizations'));
  const [failures, syncFailures] = await Promise.all([listFailures(db), listProviderSyncFailures(db, { organizationId })]); const tenantFailures = failures.filter((failure) => failure.organizationId === organizationId);
  return <AppPage><TenantWorkspaceHeader goldId={goldId} id={organizationId} name={tenant.name} currency={tenant.currency} /><section className="mt-6"><h2 className="text-lg font-semibold">Operational failures</h2><div className="mt-4"><DataTable rows={tenantFailures} rowKey={(row) => `${row.occurredAt}-${row.subject}`} empty="No platform failures for this tenant." columns={[{ key: 'kind', header: 'Kind', emphasis: 'primary', cell: (row) => row.kind }, { key: 'subject', header: 'Subject', cell: (row) => row.subject || '—' }, { key: 'detail', header: 'Detail', cell: (row) => row.detail || '—' }, { key: 'occurred', header: 'Occurred', cell: (row) => new Date(row.occurredAt).toLocaleString() }]} /></div></section><section className="mt-8"><h2 className="text-lg font-semibold">Provider reconciliation failures</h2><div className="mt-4"><DataTable rows={syncFailures} rowKey={(row) => row.id} empty="No provider reconciliation failures." columns={[{ key: 'meter', header: 'Meter', emphasis: 'primary', cell: (row) => row.meterId ?? '—' }, { key: 'detail', header: 'Detail', cell: (row) => row.detail }, { key: 'occurred', header: 'Occurred', cell: (row) => new Date(row.occurredAt).toLocaleString() }]} /></div></section></AppPage>;
}
