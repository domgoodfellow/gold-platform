import { redirect } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { getDb } from '@/lib/db/server';
import { getTenant } from '@/lib/domain/platform/tenants';
import { activeSupportSession, listMembersForSupport } from '@/lib/domain/platform/support';
import { TenantWorkspaceHeader } from '@/features/platform/tenant-workspace';
import { SupportSessionBanner, SupportSessionOpener } from './support-view';

export const dynamic = 'force-dynamic';

export default async function PlatformOrganizationOverview({ params }: PageProps<'/platform/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  const db = await getDb();
  const tenant = await getTenant(db, organizationId);
  if (!tenant) redirect('/platform/organizations');

  const session = await activeSupportSession(db, { organizationId });
  const members = session ? await listMembersForSupport(db, { organizationId }) : [];

  return <AppPage width="full"><TenantWorkspaceHeader id={tenant.id} name={tenant.name} currency={tenant.currency} /><div className="mt-6 grid gap-4 md:grid-cols-3"><Card><CardHeader><CardDescription>Tenant lifecycle</CardDescription><CardTitle className="text-xl">Active workspace</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Created {new Date(tenant.createdAt).toLocaleDateString()}.</CardContent></Card><Card><CardHeader><CardDescription>Optional modules</CardDescription><CardTitle className="text-xl">{tenant.moduleKeys.length}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{tenant.moduleKeys.length ? tenant.moduleKeys.join(', ') : 'No optional modules recorded.'}</CardContent></Card><Card><CardHeader><CardDescription>Last activity</CardDescription><CardTitle className="text-xl">{tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleDateString() : 'No activity'}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Timezone: {tenant.timezone}</CardContent></Card></div><div className="mt-6">{session ? <SupportSessionBanner organizationId={organizationId} session={session} members={members} /> : <SupportSessionOpener organizationId={organizationId} />}</div></AppPage>;
}
