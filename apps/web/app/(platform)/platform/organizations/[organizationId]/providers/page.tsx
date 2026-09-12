import { redirect } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { DataTable } from '@/components/display/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { listProviderBindings, listProviderResources } from '@/lib/domain/providers/bindings';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { ProvisionTwilioForm, RegisterPhoneNumberForm, SetResourceStatusForm } from '../forms';

export const dynamic = 'force-dynamic';
export default async function TenantProviders({ params }: PageProps<'/platform/organizations/[organizationId]/providers'>) {
  const { organizationId } = await params; const db = await getDb(); const tenant = await getTenant(db, organizationId); if (!tenant) redirect('/platform/organizations');
  const [bindings, resources] = await Promise.all([listProviderBindings(db, { organizationId }), listProviderResources(db, { organizationId })]);
  return <AppPage width="full"><TenantWorkspaceHeader id={organizationId} name={tenant.name} currency={tenant.currency} /><div className="mt-6 grid gap-4 xl:grid-cols-3"><Card><CardHeader><CardDescription>Telephony binding</CardDescription><CardTitle>Provision Twilio</CardTitle></CardHeader><CardContent><ProvisionTwilioForm organizationId={organizationId} /></CardContent></Card><Card><CardHeader><CardDescription>Existing tenant resource</CardDescription><CardTitle>Register number</CardTitle></CardHeader><CardContent><RegisterPhoneNumberForm organizationId={organizationId} /></CardContent></Card><Card><CardHeader><CardDescription>Verification state</CardDescription><CardTitle>Update resource</CardTitle></CardHeader><CardContent><SetResourceStatusForm organizationId={organizationId} /></CardContent></Card></div><div className="mt-6"><DataTable rows={bindings} rowKey={(row) => row.id} empty="No provider bindings." columns={[{ key: 'provider', header: 'Provider', emphasis: 'primary', cell: (row) => row.providerKey }, { key: 'status', header: 'Status', cell: (row) => row.status }, { key: 'external', header: 'External account ID', cell: (row) => row.externalAccountId ?? '—' }, { key: 'verified', header: 'Last verified', cell: (row) => row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : 'Not verified' }, { key: 'error', header: 'Last error', cell: (row) => row.lastError ?? '—' }]} /></div><div className="mt-6"><DataTable rows={resources} rowKey={(row) => row.id} empty="No provider resources." columns={[{ key: 'type', header: 'Resource', emphasis: 'primary', cell: (row) => row.resourceType }, { key: 'external', header: 'External ID', cell: (row) => row.externalId }, { key: 'status', header: 'Status', cell: (row) => row.status }, { key: 'verified', header: 'Last verified', cell: (row) => row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : 'Not verified' }]} /></div></AppPage>;
}
