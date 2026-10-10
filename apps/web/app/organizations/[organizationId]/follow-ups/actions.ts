'use server';
import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { createFollowUp, updateFollowUp, changeFollowUpStatus, listFollowUps, type FollowUpKind } from '@/lib/domain/follow-ups/follow-ups';
import { listOpportunities } from '@/lib/domain/opportunities/opportunities';
import { localDateTimeToInstant } from '@/lib/domain/scheduling/window';
export type FollowUpActionState = { error: string | null; savedId: string | null };
const field = (form: FormData, key: string) => String(form.get(key) ?? '');
async function assertFollowUpAccess(result: Awaited<ReturnType<typeof requireOrganization>>, organizationId: string) {
  if (!result.organization.capabilities.includes('follow_up.manage')) throw new DomainError('Your role cannot manage follow-ups.', 'follow_ups.forbidden');
  const states = await organizationResolvedFeatureStates(result.db, { organizationId });
  if (!availableFeatureKeys(states).has('follow_ups')) throw new DomainError('Follow-ups are not active for this organization.', 'follow_ups.unavailable');
}
export async function searchFollowUpOpportunities(organizationId: string, customerId: string) {
  const { db } = await requireOrganization(organizationId);
  if (!customerId) return [];
  const items = await listOpportunities(db, { organizationId, customerId, limit: 100 });
  return items.map(({ id, title }) => ({ id, title }));
}
export async function readFollowUpForDrawer(organizationId:string,id:string) {
  const {db}=await requireOrganization(organizationId);
  const states=await organizationResolvedFeatureStates(db,{organizationId});
  if(!availableFeatureKeys(states).has('follow_ups'))return null;
  const items=await listFollowUps(db,{organizationId,id,limit:1});
  return items[0]??null;
}
export async function saveFollowUpAction(_previous: FollowUpActionState, form: FormData): Promise<FollowUpActionState> {
  try {
    const organizationId = field(form,'organizationId');
    const access = await requireOrganization(organizationId);
    await assertFollowUpAccess(access, organizationId);
    const { db, organization } = access;
    const id = field(form,'id');
    const input = { organizationId, customerId: field(form,'customerId'), opportunityId: field(form,'opportunityId'), kind: field(form,'kind') as FollowUpKind,
      title: field(form,'title'), notes: field(form,'notes'), dueAt: localDateTimeToInstant(field(form,'dueAt'), organization.timezone), ownerMembershipId: field(form,'ownerMembershipId') };
    const savedId = id || await createFollowUp(db,input);
    if (id) await updateFollowUp(db,{ ...input, id });
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null, savedId };
  } catch(error) { if (error instanceof DomainError) return { error: error.message, savedId: null }; throw error; }
}
export async function changeFollowUpStatusAction(_previous: FollowUpActionState, form: FormData): Promise<FollowUpActionState> {
  try {
    const organizationId = field(form,'organizationId');
    const access = await requireOrganization(organizationId);
    await assertFollowUpAccess(access, organizationId);
    const { db } = access;
    const id = field(form,'id');
    await changeFollowUpStatus(db,{ organizationId, id, status: field(form,'status') as 'completed' | 'cancelled' });
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null, savedId: id };
  } catch(error) { if (error instanceof DomainError) return { error: error.message, savedId: null }; throw error; }
}
