import { getBusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { loadConfigurationContext } from '@/lib/route/workspace-configuration';
import { businessDestinations } from '@/lib/application/shell/business-navigation';
import { BusinessProfileForm } from './business-profile-form';
export async function BusinessProfileSettings({organizationId}:{organizationId:string}) {
  const {db,organization,gate}=await loadConfigurationContext(organizationId);
  if(!organization.capabilities.includes('organization.manage'))return null;
  const profile=await getBusinessProfile(db,organizationId);
  const destinations=businessDestinations({organizationId,...gate});
  return <BusinessProfileForm organizationId={organizationId} profile={profile} destinations={destinations}/>;
}
