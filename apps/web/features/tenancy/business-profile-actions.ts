'use server';
import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { saveBusinessProfile, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { DomainError } from '@/lib/domain/errors';
export async function saveBusinessProfileAction(organizationId:string,profile:BusinessProfile):Promise<{error:string|null}> {
  const {db}=await requireOrganization(organizationId);
  try { await saveBusinessProfile(db,organizationId,profile); }
  catch(error) { if(error instanceof DomainError)return {error:error.message}; throw error; }
  revalidatePath(`/organizations/${organizationId}`,'layout');
  return {error:null};
}
