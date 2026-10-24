'use server';
import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, type ContactLifecycle, type LeadTemperature } from '@/lib/domain/contacts/contacts';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { createContact, listCompanies } from '@/lib/domain/contacts/contacts';
import { DomainError } from '@/lib/domain/errors';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { requireOrganization } from '@/lib/route/organization';

/** `id` is the new contact's, from the canonical creation command, so the caller can open it. */
export type CreateCustomerState = { error: string | null; created: boolean; id?: string; contactType?: 'person' | 'company'; name?: string };

export async function createCustomerAction(
  _previous: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  let id: string;
  let contactType: 'person' | 'company';
  try {
    const requested=String(formData.get('contactType') ?? '');
    if(requested !== 'person' && requested !== 'company') return {error:'Choose Person or Company.',created:false};
    contactType = requested;
    id = await createContact(db, {
      organizationId,
      contactType,
      companyId: contactType==='person' ? String(formData.get('companyId') ?? '') || undefined : undefined,
      affiliationTitle: String(formData.get('affiliationTitle') ?? ''),
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      custom: customValuesFromFormData(formData),
      lifecycle: CONTACT_LIFECYCLES.includes(String(formData.get('lifecycle')) as ContactLifecycle) ? String(formData.get('lifecycle')) as ContactLifecycle : undefined,
      leadTemperature: LEAD_TEMPERATURES.includes(String(formData.get('leadTemperature')) as LeadTemperature) ? String(formData.get('leadTemperature')) as LeadTemperature : undefined,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, created: false };
    }
    throw error;
  }

  // The organization id arrives from a hidden field, which a client could edit. That is
  // fine and deliberately not re-validated here: RLS refuses an insert into an organization
  // the caller does not belong to, so tampering produces a refusal rather than a leak.
  revalidatePath(`/organizations/${organizationId}/crm/contacts`);
  revalidatePath(`/organizations/${organizationId}/crm`);
  return { error: null, created: true, id, contactType, name: String(formData.get('name') ?? '').trim() };
}

export async function companyOptionsAction(organizationId:string) {
 const {db}=await requireOrganization(organizationId);
 return listCompanies(db,organizationId);
}
