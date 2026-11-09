import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { counted, type Counted } from '@/lib/domain/counted';
import { memberDisplayNames } from '@/lib/domain/tenancy/members';

export type TaskKind = 'call' | 'email' | 'meeting' | 'task';
export type TaskStatus = 'open' | 'completed' | 'cancelled';
export type CrmTask = {
  id: string; customerId: string; customerName: string; opportunityId: string | null; opportunityTitle: string | null;
  kind: TaskKind; title: string; notes: string | null; dueAt: string; ownerMembershipId: string | null;
  ownerName: string | null; status: TaskStatus; completedAt: string | null; createdAt: string;
};
export type TaskInput = {
  organizationId: string; customerId: string; opportunityId?: string | null; kind: TaskKind;
  title: string; notes?: string | null; dueAt: string; ownerMembershipId?: string | null;
};
export type TaskFilter = {
  organizationId: string; id?: string; search?: string; status?: TaskStatus; kind?: TaskKind;
  ownerMembershipId?: string | null; customerId?: string; opportunityId?: string;
  before?: string; from?: string; limit?: number; offset?: number; recent?: boolean;
};
const SELECT = '*, customer:contacts!crm_follow_ups_organization_id_customer_id_fkey(name), opportunity:opportunities!crm_follow_ups_organization_id_customer_id_opportunity_id_fkey(title)';
function failure(message: string): never { throw new DomainError(message, 'follow_ups.failed'); }
export async function listTasks(db: Db, input: TaskFilter): Promise<Counted<CrmTask>> {
  let query = db.from('crm_tasks').select(SELECT, { count: 'exact' }).eq('organization_id', input.organizationId);
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
  return counted((data ?? []).map(row => ({ id: row.id, customerId: row.customer_id, customerName: row.customer?.name ?? 'Contact',
    opportunityId: row.opportunity_id, opportunityTitle: row.opportunity?.title ?? null, kind: row.kind as TaskKind,
    title: row.title, notes: row.notes, dueAt: row.due_at, ownerMembershipId: row.owner_membership_id,
    ownerName: row.owner_membership_id ? names.get(row.owner_membership_id) ?? 'Member' : null,
    status: row.status as TaskStatus, completedAt: row.completed_at, createdAt: row.created_at })), count);
}
function values(input: TaskInput) {
  const title = input.title.trim();
  if (!title || title.length > 200 || (input.notes?.length ?? 0) > 10000) failure('Enter a title up to 200 characters and notes up to 10,000 characters.');
  if (!['call','email','meeting','task'].includes(input.kind)) failure('Choose a task kind.');
  if (!Number.isFinite(Date.parse(input.dueAt))) failure('Enter a valid due date and time.');
  return { opportunity_id: input.opportunityId || null, kind: input.kind, title, notes: input.notes?.trim() || null,
    due_at: new Date(input.dueAt).toISOString(), owner_membership_id: input.ownerMembershipId || null };
}
export async function createTask(db: Db, input: TaskInput): Promise<string> {
  const actor = await requireActor(db);
  const { data, error } = await db.from('crm_tasks').insert({ ...values(input), organization_id: input.organizationId, customer_id: input.customerId, created_by: actor.id }).select('id').single();
  if (error) failure(error.message);
  return data.id;
}
/** Of these contacts, the ones that already have an open Call task: on the Dialer's call list. */
export async function openCallCustomerIds(db: Db, input: { organizationId: string; customerIds: readonly string[] }): Promise<Set<string>> {
  if (!input.customerIds.length) return new Set();
  const { data, error } = await db.from('crm_tasks').select('customer_id').eq('organization_id', input.organizationId)
    .eq('status', 'open').eq('kind', 'call').in('customer_id', [...input.customerIds]);
  if (error) failure(error.message);
  return new Set((data ?? []).map(row => row.customer_id));
}
/** One open Call task per contact, in one statement: every contact is added or none is. */
export async function createCallTasks(db: Db, input: { organizationId: string; customerIds: readonly string[]; title: string; dueAt: string }): Promise<number> {
  const actor = await requireActor(db);
  if (!input.customerIds.length) return 0;
  const shared = values({ organizationId: input.organizationId, customerId: '', kind: 'call', title: input.title, dueAt: input.dueAt });
  const rows = input.customerIds.map(customerId => ({ ...shared, organization_id: input.organizationId, customer_id: customerId, created_by: actor.id }));
  const { data, error } = await db.from('crm_tasks').insert(rows).select('id');
  if (error) failure(error.message);
  return data.length;
}
export async function updateTask(db: Db, input: TaskInput & { id: string }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db.from('crm_tasks').update(values(input)).eq('organization_id', input.organizationId).eq('customer_id',input.customerId).eq('id',input.id).eq('status','open').select('id');
  if (error) failure(error.message);
  if (!data.length) failure('This task is no longer open or is not yours to edit.');
}
export async function changeTaskStatus(db: Db, input: { organizationId: string; id: string; status: 'completed' | 'cancelled' }): Promise<void> {
  await requireActor(db);
  if (!['completed','cancelled'].includes(input.status)) failure('Choose complete or cancel.');
  const { data, error } = await db.from('crm_tasks').update({ status: input.status }).eq('organization_id', input.organizationId).eq('id', input.id).eq('status','open').select('id');
  if (error) failure(error.message);
  if (!data.length) failure('This task is no longer open or is not yours to change.');
}
