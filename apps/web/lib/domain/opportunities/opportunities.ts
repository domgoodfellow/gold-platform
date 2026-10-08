import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { counted, type Counted } from '@/lib/domain/counted';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { memberDisplayNames } from '@/lib/domain/tenancy/members';

export type OpportunityKind = 'open' | 'won' | 'lost';
export type OpportunityStage = { id: string; name: string; position: number; kind: OpportunityKind };
export type Opportunity = {
  id: string; customerId: string; customerName: string; title: string;
  stageId: string | null; stage: OpportunityStage | null;
  amountMinor: number | null; currency: string | null;
  ownerMembershipId: string | null; ownerName: string | null;
  expectedCloseOn: string | null; createdAt: string;
  nextFollowUp?: { id: string; title: string; dueAt: string } | null;
};
export type OpportunityInput = {
  organizationId: string; title: string; stageId?: string | null;
  amountMinor?: number | null; currency?: string | null;
  ownerMembershipId?: string | null; expectedCloseOn?: string | null;
};
const SELECT = 'id, customer_id, title, stage_id, amount_minor, currency, owner_membership_id, expected_close_on, created_at, next_follow_up_id, next_follow_up_title, next_follow_up_due_at, customer:customers!opportunities_customer_same_org(name), stage:opportunity_stages!opportunities_stage_same_org(id,name,kind,position), owner:memberships!opportunities_owner_same_org(display_name)';

function failure(error: { message: string }, code: string): never {
  if (error.message.includes('opportunity_stages_org_terminal')) throw new DomainError('Only one Won stage and one Lost stage may be configured.', 'opportunities.stage_terminal_taken');
  if (error.message.includes('opportunity_stages_org_name')) throw new DomainError('An opportunity stage with that name already exists.', 'opportunities.stage_name_taken');
  throw new DomainError(error.message, `opportunities.${code}`);
}
type ReadRow = {
  id: string; customer_id: string; title: string; stage_id: string | null; amount_minor: number | null;
  currency: string | null; owner_membership_id: string | null; expected_close_on: string | null; created_at: string;
  customer: { name: string } | null; stage: { id: string; name: string; kind: string; position: number } | null;
  owner: { display_name: string } | null;
  next_follow_up_id?: string | null; next_follow_up_title?: string | null; next_follow_up_due_at?: string | null;
};
function opportunity(row: ReadRow, ownerNames?: Map<string, string>): Opportunity {
  return { id: row.id, customerId: row.customer_id, customerName: row.customer?.name ?? 'Customer', title: row.title,
    stageId: row.stage_id, stage: row.stage ? { ...row.stage, kind: row.stage.kind as OpportunityKind } : null,
    amountMinor: row.amount_minor, currency: row.currency, ownerMembershipId: row.owner_membership_id,
    ownerName: row.owner_membership_id ? ownerNames?.get(row.owner_membership_id) ?? row.owner?.display_name ?? 'Member' : null,
    expectedCloseOn: row.expected_close_on, createdAt: row.created_at,
    nextFollowUp: row.next_follow_up_id && row.next_follow_up_due_at ? { id: row.next_follow_up_id, title: row.next_follow_up_title ?? 'Follow-up', dueAt: row.next_follow_up_due_at } : null };
}

/** Exact total plus a bounded page; all filters run in Postgres under organization RLS. */
export async function listOpportunities(db: Db, input: {
  organizationId: string; customerId?: string; stageId?: string | null; ownerMembershipId?: string | null;
  kind?: OpportunityKind; search?: string; limit?: number; offset?: number; noNext?: boolean; closeFrom?: string; closeBefore?: string;
}): Promise<Counted<Opportunity>> {
  const select = input.kind ? SELECT.replace('opportunities_stage_same_org(', 'opportunities_stage_same_org!inner(') : SELECT;
  let query = db.from('opportunity_worklist').select(select, { count: 'exact' }).eq('organization_id', input.organizationId);
  if (input.noNext) query = query.eq('has_future_follow_up', false);
  if (input.closeFrom) query = query.gte('expected_close_on', input.closeFrom);
  if (input.closeBefore) query = query.lt('expected_close_on', input.closeBefore);
  if (input.customerId) query = query.eq('customer_id', input.customerId);
  if (input.stageId === null) query = query.is('stage_id', null);
  else if (input.stageId) query = query.eq('stage_id', input.stageId);
  if (input.ownerMembershipId === null) query = query.is('owner_membership_id', null);
  else if (input.ownerMembershipId) query = query.eq('owner_membership_id', input.ownerMembershipId);
  if (input.kind) query = query.eq('stage.kind', input.kind);
  const search = input.search?.trim().replace(/[%_,()]/g, ' ');
  if (search) query = query.ilike('title', `%${search}%`);
  const limit = Math.max(1, Math.min(Number.isSafeInteger(input.limit) ? input.limit! : 50, 100));
  const offset = Math.max(0, Number.isSafeInteger(input.offset) ? input.offset! : 0);
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
  if (error) failure(error, 'list_failed');
  // Dynamic inner-join selection is runtime-controlled here; the same read shape in both cases.
  const rows = (data as unknown as ReadRow[] ?? []);
  const ownerNames = rows.some((row) => row.owner_membership_id) ? await memberDisplayNames(db, input.organizationId) : undefined;
  return counted(rows.map((row) => opportunity(row, ownerNames)), count);
}
export async function getOpportunity(db: Db, input: { organizationId: string; opportunityId: string }): Promise<Opportunity | null> {
  const { data, error } = await db.from('opportunity_worklist').select(SELECT).eq('organization_id', input.organizationId).eq('id', input.opportunityId).maybeSingle();
  if (error) failure(error, 'get_failed');
  if (!data) return null;
  const ownerNames = data.owner_membership_id ? await memberDisplayNames(db, input.organizationId) : undefined;
  return opportunity(data as unknown as ReadRow, ownerNames);
}
export async function previewOpportunityPipeline(db: Db, organizationId: string): Promise<Opportunity[]> {
  const { data, error } = await db.rpc('crm_pipeline_preview', { p_organization_id: organizationId, p_limit: 10 }).select(SELECT);
  if (error) failure(error, 'pipeline_failed');
  const names = await memberDisplayNames(db, organizationId);
  return (data as unknown as ReadRow[] ?? []).map(row => opportunity(row, names));
}
function values(input: OpportunityInput) {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new DomainError('Enter an opportunity title of up to 200 characters.', 'opportunities.title_invalid');
  const amount = input.amountMinor ?? null;
  const currency = input.currency?.trim().toUpperCase() || null;
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw new DomainError('Value must be a non-negative integer in minor units.', 'opportunities.value_invalid');
  if ((amount === null) !== (currency === null) || (currency && !/^[A-Z]{3}$/.test(currency))) throw new DomainError('Enter a currency with the value, or leave both blank.', 'opportunities.currency_invalid');
  const date = input.expectedCloseOn || null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new DomainError('Enter a valid expected close date.', 'opportunities.date_invalid');
  return { title, stage_id: input.stageId || null, amount_minor: amount, currency, owner_membership_id: input.ownerMembershipId || null, expected_close_on: date };
}
export async function createOpportunity(db: Db, input: OpportunityInput & { customerId: string }): Promise<string> {
  const actor = await requireActor(db);
  const { data, error } = await db.from('opportunities').insert({ ...values(input), customer_id: input.customerId, organization_id: input.organizationId, created_by: actor.id }).select('id').single();
  if (error) failure(error, 'create_failed');
  return data.id;
}
export async function updateOpportunity(db: Db, input: OpportunityInput & { opportunityId: string }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db.from('opportunities').update(values(input)).eq('organization_id', input.organizationId).eq('id', input.opportunityId).select('id');
  if (error) failure(error, 'update_failed');
  if (!data.length) throw new DomainError('That opportunity is not yours to change.', 'opportunities.update_refused');
}
/** Stage-only writes cannot overwrite a concurrent value/owner edit. The table trigger owns events. */
export async function moveOpportunity(db: Db, input: { organizationId: string; opportunityId: string; stageId: string | null }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db.from('opportunities').update({ stage_id: input.stageId }).eq('organization_id', input.organizationId).eq('id', input.opportunityId).select('id');
  if (error) failure(error, 'move_failed');
  if (!data.length) throw new DomainError('That opportunity is not yours to change.', 'opportunities.update_refused');
}
export async function listOpportunityStages(db: Db, input: { organizationId: string }): Promise<OpportunityStage[]> {
  const { data, error } = await db.from('opportunity_stages').select('id,name,kind,position').eq('organization_id', input.organizationId).order('position').order('name');
  if (error) failure(error, 'stages_failed');
  return data.map((stage) => ({ ...stage, kind: stage.kind as OpportunityKind }));
}
function stageValues(input: { name: string; position: number; kind: OpportunityKind }) {
  const name = input.name.trim();
  if (!name || name.length > 64 || !Number.isInteger(input.position) || input.position < 0 || !['open', 'won', 'lost'].includes(input.kind)) throw new DomainError('Enter a stage name, non-negative position and Open, Won or Lost classification.', 'opportunities.stage_invalid');
  return { ...input, name };
}
export async function createOpportunityStage(db: Db, input: { organizationId: string; name: string; position: number; kind: OpportunityKind }): Promise<string> {
  const actor = await requireActor(db);
  const { organizationId, ...fields } = input;
  const { data, error } = await db.from('opportunity_stages').insert({ ...stageValues(fields), organization_id: organizationId, created_by: actor.id }).select('id').single();
  if (error) failure(error, 'stage_create_failed');
  return data.id;
}
export async function updateOpportunityStage(db: Db, input: { organizationId: string; id: string; name: string; position: number; kind: OpportunityKind }): Promise<void> {
  const { organizationId, id, ...fields } = input;
  await requireActor(db);
  const { data, error } = await db.from('opportunity_stages').update(stageValues(fields)).eq('organization_id', organizationId).eq('id', id).select('id');
  if (error) failure(error, 'stage_update_failed');
  if (!data.length) throw new DomainError('That stage is not yours to change.', 'opportunities.stage_update_refused');
}
export type OpportunitySummary = { stageId: string | null; name: string; kind: OpportunityKind | null; position: number | null; count: number; values: { currency: string; amountMinor: string }[] };
export async function summarizeOpportunities(db: Db, input: { organizationId: string }): Promise<OpportunitySummary[]> {
  const { data, error } = await db.rpc('opportunity_stage_summary', { p_organization_id: input.organizationId });
  if (error) failure(error, 'summary_failed');
  const stages = new Map<string | null, OpportunitySummary>();
  for (const row of data) {
    const summary = stages.get(row.stage_id) ?? { stageId: row.stage_id, name: row.stage_name, kind: row.stage_kind as OpportunityKind | null, position: row.stage_position, count: 0, values: [] };
    summary.count += row.opportunity_count;
    if (row.currency && row.value_minor !== null) summary.values.push({ currency: row.currency, amountMinor: row.value_minor });
    stages.set(row.stage_id, summary);
  }
  return [...stages.values()].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name));
}
