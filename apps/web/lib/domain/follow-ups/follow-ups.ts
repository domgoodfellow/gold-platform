import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { counted, type Counted } from '@/lib/domain/counted';
import { memberDisplayNames } from '@/lib/domain/tenancy/members';

export type FollowUpKind = 'call' | 'email' | 'meeting' | 'task';
export type FollowUpStatus = 'open' | 'completed' | 'cancelled';
export type FollowUp = {
  id: string; customerId: string; customerName: string; opportunityId: string | null; opportunityTitle: string | null;
  kind: FollowUpKind; title: string; notes: string | null; dueAt: string; ownerMembershipId: string | null;
  ownerName: string | null; status: FollowUpStatus; completedAt: string | null; createdAt: string;
};
export type FollowUpInput = {
  organizationId: string; customerId: string; opportunityId?: string | null; kind: FollowUpKind;
  title: string; notes?: string | null; dueAt: string; ownerMembershipId?: string | null;
};
export type FollowUpFilter = {
  organizationId: string; id?: string; search?: string; status?: FollowUpStatus; kind?: FollowUpKind;
  ownerMembershipId?: string | null; customerId?: string; opportunityId?: string;
  before?: string; from?: string; limit?: number; offset?: number; recent?: boolean;
};
const SELECT = '*, customer:customers!crm_follow_ups_organization_id_customer_id_fkey(name), opportunity:opportunities!crm_follow_ups_organization_id_customer_id_opportunity_id_fkey(title)';
function failure(message: string): never { throw new DomainError(message, 'follow_ups.failed'); }
export async function listFollowUps(db: Db, input: FollowUpFilter): Promise<Counted<FollowUp>> {
  let query = db.from('crm_follow_ups').select(SELECT, { count: 'exact' }).eq('organization_id', input.organizationId);
  if (input.id) query = query.eq('id',input.id);
  if (input.status) query = query.eq('status', input.status);
  if (input.kind) query = query.eq('kind', input.kind);
  if (input.customerId) query = query.eq('customer_id', input.customerId);
  if (input.opportunityId) query = query.eq('opportunity_id', input.opportunityId);
  if (input.ownerMembershipId === null) query = query.is('owner_membership_id', null);
  else if (input.ownerMembershipId) query = query.eq('owner_membership_id', input.ownerMembershipId);
  if (input.before) query = query.lt('due_at', input.before);
  if (input.from) query = query.gte('due_at', input.from);
  const search = input.search?.trim().replace(/[%_,()]/g, ' ');
  if (search) query = query.ilike('title', `%${search}%`);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
  const offset = Math.max(0, input.offset ?? 0);
  const { data, error, count } = await query.order(input.recent ? 'completed_at' : 'due_at', { ascending: !input.recent, nullsFirst: false }).order('id').range(offset, offset + limit - 1);
  if (error) failure(error.message);
  const names = await memberDisplayNames(db, input.organizationId);
  return counted((data ?? []).map(row => ({ id: row.id, customerId: row.customer_id, customerName: row.customer?.name ?? 'Customer',
    opportunityId: row.opportunity_id, opportunityTitle: row.opportunity?.title ?? null, kind: row.kind as FollowUpKind,
    title: row.title, notes: row.notes, dueAt: row.due_at, ownerMembershipId: row.owner_membership_id,
    ownerName: row.owner_membership_id ? names.get(row.owner_membership_id) ?? 'Member' : null,
    status: row.status as FollowUpStatus, completedAt: row.completed_at, createdAt: row.created_at })), count);
}
function values(input: FollowUpInput) {
  const title = input.title.trim();
  if (!title || title.length > 200 || (input.notes?.length ?? 0) > 10000) failure('Enter a title up to 200 characters and notes up to 10,000 characters.');
  if (!['call','email','meeting','task'].includes(input.kind)) failure('Choose a follow-up kind.');
  if (!Number.isFinite(Date.parse(input.dueAt))) failure('Enter a valid due date and time.');
  return { opportunity_id: input.opportunityId || null, kind: input.kind, title, notes: input.notes?.trim() || null,
    due_at: new Date(input.dueAt).toISOString(), owner_membership_id: input.ownerMembershipId || null };
}
export async function createFollowUp(db: Db, input: FollowUpInput): Promise<string> {
  const actor = await requireActor(db);
  const { data, error } = await db.from('crm_follow_ups').insert({ ...values(input), organization_id: input.organizationId, customer_id: input.customerId, created_by: actor.id }).select('id').single();
  if (error) failure(error.message);
  return data.id;
}
export async function updateFollowUp(db: Db, input: FollowUpInput & { id: string }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db.from('crm_follow_ups').update(values(input)).eq('organization_id', input.organizationId).eq('customer_id',input.customerId).eq('id',input.id).eq('status','open').select('id');
  if (error) failure(error.message);
  if (!data.length) failure('This follow-up is no longer open or is not yours to edit.');
}
export async function changeFollowUpStatus(db: Db, input: { organizationId: string; id: string; status: 'completed' | 'cancelled' }): Promise<void> {
  await requireActor(db);
  if (!['completed','cancelled'].includes(input.status)) failure('Choose complete or cancel.');
  const { data, error } = await db.from('crm_follow_ups').update({ status: input.status }).eq('organization_id', input.organizationId).eq('id', input.id).eq('status','open').select('id');
  if (error) failure(error.message);
  if (!data.length) failure('This follow-up is no longer open or is not yours to change.');
}
