import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { Card, Disclosure } from '@/components/containers/card';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { getDb } from '@/lib/db/server';
import { listTenants } from '@/lib/domain/platform/tenants';
import { ProvisionForm } from '../provision-form';

export default async function PlatformOrganizationsPage() {
  const { tenants, total } = await listTenants(await getDb());
  return <AppPage width="full"><div className="flex items-center justify-between gap-4"><div><PageHeading>Organizations</PageHeading><Hint className="mt-1 block">{total === 1 ? '1 organization' : `${total} organizations`} on GOLD.</Hint></div></div><Disclosure summary="Provision organization" tone="primary" className="mt-6 max-w-3xl"><ProvisionForm /></Disclosure><Card className="mt-6 p-0"><div className="p-4"><DataTable rows={tenants} rowKey={(tenant) => tenant.id} empty="No organization has been provisioned." columns={[{key:'name',header:'Organization',emphasis:'primary',cell:(tenant)=><Link className="underline underline-offset-4" href={`/platform/organizations/${tenant.id}`}>{tenant.name}</Link>},{key:'currency',header:'Currency',cell:(tenant)=>tenant.currency || '—'},{key:'modules',header:'Modules',cell:(tenant)=>tenant.moduleKeys.length ? tenant.moduleKeys.join(', ') : 'Kernel only'},{key:'activity',header:'Last activity',cell:(tenant)=>tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toLocaleString('en-CA',{timeZone:tenant.timezone}) : 'Nothing yet'}]} /></div></Card></AppPage>;
}
