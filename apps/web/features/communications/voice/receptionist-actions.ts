'use server';
import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';

export async function configureReceptionist(organizationId: string, input: {revision:number; deploymentRef:string; enabled:boolean; maxSeconds:number; budgetSeconds:number}) {
  const {db}=await requireOrganization(organizationId);
  const {error}=await db.rpc('configure_voice_receptionist',{p_organization_id:organizationId,p_revision:input.revision,p_deployment_ref:input.deploymentRef,p_enabled:input.enabled,p_max_seconds:input.maxSeconds,p_budget_seconds:input.budgetSeconds});
  if(error)return {error:error.message};
  revalidatePath(`/organizations/${organizationId}/comms/configuration/calling`);
  return {error:null};
}
