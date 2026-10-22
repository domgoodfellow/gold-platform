'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { parseOpportunityValue } from '@/lib/domain/opportunities/money';
import { createOpportunity, updateOpportunity, moveOpportunity, createOpportunityStage, updateOpportunityStage, type OpportunityKind } from '@/lib/domain/opportunities/opportunities';

export type OpportunityActionState = { error: string | null; savedId: string | null };
const field = (form: FormData, key: string) => String(form.get(key) ?? '');
function refresh(organizationId: string) {
  revalidatePath(`/organizations/${organizationId}`, 'layout');
}
export async function searchOpportunityCustomers(organizationId: string, search: string) {
  const { db } = await requireOrganization(organizationId);
  const customers = await listContacts(db, { organizationId, search, limit: 20 });
  return { customers: customers.map(({ id, name }) => ({ id, name })), total: customers.total };
}
export async function saveOpportunityAction(_previous: OpportunityActionState, form: FormData): Promise<OpportunityActionState> {
  const organizationId = field(form, 'organizationId');
  const { db, organization } = await requireOrganization(organizationId);
  const id = field(form, 'opportunityId');
  if (!organization.capabilities.includes(id ? 'opportunity.update' : 'opportunity.create')) return { error: 'Your role cannot save this opportunity.', savedId: null };
  try {
    const currency = field(form, 'currency').trim().toUpperCase();
    const amountMinor = parseOpportunityValue(field(form, 'value'), currency);
    const input = { organizationId, title: field(form, 'title'), stageId: field(form, 'stageId'), ownerMembershipId: field(form, 'ownerMembershipId'), expectedCloseOn: field(form, 'expectedCloseOn'), amountMinor, currency: amountMinor === null ? null : currency };
    const savedId = id || await createOpportunity(db, { ...input, customerId: field(form, 'customerId') });
    if (id) await updateOpportunity(db, { ...input, opportunityId: id });
    refresh(organizationId);
    return { error: null, savedId };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, savedId: null };
    throw error;
  }
}
export async function moveOpportunityAction(_previous: OpportunityActionState, form: FormData): Promise<OpportunityActionState> {
  const organizationId = field(form, 'organizationId');
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('opportunity.update')) return { error: 'Your role cannot move opportunities.', savedId: null };
  try {
    const opportunityId = field(form, 'opportunityId');
    await moveOpportunity(db, { organizationId, opportunityId, stageId: field(form, 'stageId') || null });
    refresh(organizationId);
    return { error: null, savedId: opportunityId };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, savedId: null };
    throw error;
  }
}
export async function saveOpportunityStageAction(_previous: OpportunityActionState, form: FormData): Promise<OpportunityActionState> {
  const organizationId = field(form, 'organizationId');
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('field.manage')) return { error: 'Your role cannot configure stages.', savedId: null };
  try {
    const id = field(form, 'id');
    const input = { organizationId, name: field(form, 'name'), position: Number(field(form, 'position')), kind: field(form, 'kind') as OpportunityKind };
    const savedId = id || await createOpportunityStage(db, input);
    if (id) await updateOpportunityStage(db, { ...input, id });
    refresh(organizationId);
    return { error: null, savedId };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, savedId: null };
    throw error;
  }
}
