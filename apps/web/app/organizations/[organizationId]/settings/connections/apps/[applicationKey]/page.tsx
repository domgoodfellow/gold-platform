import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { LibraryKeyForm } from '@/features/integrations/connections/library-controls';
import { libraryApplication } from '@/lib/domain/integrations/app-library';
import { requireOrganization } from '@/lib/route/organization';
import {getConnection} from '@/lib/domain/integrations/connections';
export default async function ConnectLibraryApp({params,searchParams}:PageProps<'/organizations/[organizationId]/settings/connections/apps/[applicationKey]'>) {
  const {organizationId,applicationKey}=await params;
  const {db,organization}=await requireOrganization(organizationId);
  const app=libraryApplication(applicationKey);
  if(!app||app.auth.type!=='api_key'||!organization.capabilities.includes('integration.manage'))notFound();
  const connectionId=(await searchParams).connection;
  if(typeof connectionId==='string') {
    const connection=await getConnection(db,{organizationId,connectionId});
    if(!connection||connection.connectorKey!==app.connector_key)notFound();
  }
  return <SettingsPageFrame><PageHeader title={`Connect ${app.name}`} crumbs={[{label:'App Library',href:`/organizations/${organizationId}/settings/connections/apps`}]}/>
    <LibraryKeyForm organizationId={organizationId} application={app.key} connectionId={typeof connectionId==='string'?connectionId:undefined}/></SettingsPageFrame>;
}
