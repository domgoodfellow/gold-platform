import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer, getCustomer } from '@/lib/domain/customers/customers';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { createOpportunity, createOpportunityStage, getOpportunity, listOpportunities, listOpportunityStages, moveOpportunity, summarizeOpportunities, updateOpportunity, updateOpportunityStage } from '@/lib/domain/opportunities/opportunities';
import { listCustomerTimeline, listRecentActivity } from '@/lib/domain/timeline/timeline';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `opportunity-${randomUUID()}@example.test`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { email, db, userId: created.data.user.id };
}
describe('canonical opportunities under real organization RLS', () => {
  let owner: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>, limited: Awaited<ReturnType<typeof account>>, creator: Awaited<ReturnType<typeof account>>;
  let organizationId: string, otherOrg: string, customerId: string, otherCustomer: string, open: string, won: string, lost: string, otherStage: string, opportunityId: string, ownerMembershipId: string, otherMember: string;
  beforeAll(async () => {
    [owner, outsider, limited, creator] = await Promise.all([account(), account(), account(), account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Opportunity tenant', currency: 'CAD' });
    otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Other opportunity tenant', currency: 'EUR' });
    expect(await listOpportunityStages(owner.db, { organizationId })).toEqual([]);
    customerId = await createCustomer(owner.db, { organizationId, name: 'Customer with several opportunities' });
    otherCustomer = await createCustomer(outsider.db, { organizationId: otherOrg, name: 'Private customer' });
    open = await createOpportunityStage(owner.db, { organizationId, name: 'Discuss', kind: 'open', position: 0 });
    won = await createOpportunityStage(owner.db, { organizationId, name: 'Agreed', kind: 'won', position: 1 });
    lost = await createOpportunityStage(owner.db, { organizationId, name: 'Declined', kind: 'lost', position: 2 });
    otherStage = await createOpportunityStage(outsider.db, { organizationId: otherOrg, name: 'Private stage', kind: 'open', position: 0 });
    ownerMembershipId = (await owner.db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', owner.userId).single()).data!.id;
    otherMember = (await outsider.db.from('memberships').select('id').eq('organization_id', otherOrg).single()).data!.id;
    const limitedRole = await createRole(owner.db, { organizationId, name: 'Customer editor only', capabilities: ['customer.create', 'customer.update'] });
    await addMember(owner.db, { organizationId, email: limited.email, roleId: limitedRole });
    const creatorRole = await createRole(owner.db, { organizationId, name: 'Opportunity creator', capabilities: ['opportunity.create'] });
    await addMember(owner.db, { organizationId, email: creator.email, roleId: creatorRole });
  });
  it('creates multiple independent opportunities and preserves the Customer lifecycle', async () => {
    opportunityId = await createOpportunity(owner.db, { organizationId, customerId, title: 'First project', stageId: open, amountMinor: 125050, currency: 'CAD', ownerMembershipId, expectedCloseOn: '2027-02-01' });
    await createOpportunity(owner.db, { organizationId, customerId, title: 'Future project' });
    const items = await listOpportunities(owner.db, { organizationId, customerId });
    expect(items.total).toBe(2);
    expect(await getOpportunity(owner.db, { organizationId, opportunityId })).toMatchObject({ title: 'First project', stage: { kind: 'open' }, amountMinor: 125050, ownerMembershipId });
    expect((await getCustomer(owner.db, { organizationId, customerId }))?.stageId).toBeNull();
  });
  it('refuses cross-tenant reads, writes and composite references without leaked state', async () => {
    expect(await getOpportunity(outsider.db, { organizationId, opportunityId })).toBeNull();
    expect(await listOpportunities(outsider.db, { organizationId })).toEqual([]);
    expect(await summarizeOpportunities(outsider.db, { organizationId })).toEqual([]);
    await expect(createOpportunity(outsider.db, { organizationId, customerId, title: 'Intrusion' })).rejects.toBeInstanceOf(Error);
    for (const fields of [{ customerId: otherCustomer }, { stageId: otherStage }, { ownerMembershipId: otherMember }]) {
      await expect(createOpportunity(owner.db, { organizationId, customerId, title: 'Bad reference', ...fields })).rejects.toBeInstanceOf(Error);
    }
    await expect(moveOpportunity(outsider.db, { organizationId, opportunityId, stageId: won })).rejects.toBeInstanceOf(Error);
  });
  it('separates Opportunity authorities from Customer authority and stage configuration', async () => {
    await expect(createOpportunity(limited.db, { organizationId, customerId, title: 'Forbidden' })).rejects.toBeInstanceOf(Error);
    await expect(updateOpportunity(limited.db, { organizationId, opportunityId, title: 'Forbidden' })).rejects.toBeInstanceOf(Error);
    await expect(createOpportunityStage(limited.db, { organizationId, name: 'Forbidden', position: 3, kind: 'open' })).rejects.toBeInstanceOf(Error);
    const id = await createOpportunity(creator.db, { organizationId, customerId, title: 'Creator staged', stageId: open });
    await expect(moveOpportunity(creator.db, { organizationId, opportunityId: id, stageId: won })).rejects.toBeInstanceOf(Error);
    const editor = await account();
    const editorRole = await createRole(owner.db, { organizationId, name: 'Opportunity editor', capabilities: ['opportunity.update'] });
    await addMember(owner.db, { organizationId, email: editor.email, roleId: editorRole });
    await expect(createOpportunity(editor.db, { organizationId, customerId, title: 'Editor cannot create' })).rejects.toBeInstanceOf(Error);
    await moveOpportunity(editor.db, { organizationId, opportunityId: id, stageId: won });
    expect((await getOpportunity(editor.db, { organizationId, opportunityId: id }))?.stageId).toBe(won);
    await moveOpportunity(editor.db, { organizationId, opportunityId: id, stageId: open });
    expect((await creator.db.from('opportunities').delete().eq('id', id)).error).not.toBeNull();
    expect((await owner.db.from('opportunity_stages').delete().eq('id', open)).error).not.toBeNull();
  });
  it('persists edits and stage changes with immutable event snapshots in customer and CRM activity', async () => {
    await updateOpportunity(owner.db, { organizationId, opportunityId, title: 'Revised project', stageId: open, amountMinor: 200000, currency: 'CAD', ownerMembershipId, expectedCloseOn: '2027-03-01' });
    await moveOpportunity(owner.db, { organizationId, opportunityId, stageId: won });
    await updateOpportunityStage(owner.db, { organizationId, id: won, name: 'Booked', kind: 'won', position: 1 });
    expect((await getOpportunity(owner.db, { organizationId, opportunityId }))?.stage?.name).toBe('Booked');
    const timeline = await listCustomerTimeline(owner.db, { organizationId, customerId });
    expect(timeline.some((entry) => entry.description.includes('Agreed (won)'))).toBe(true);
    expect((await listRecentActivity(owner.db, { organizationId, scope: 'crm' })).some((entry) => entry.action === 'opportunity.created')).toBe(true);
    const { data: events } = await owner.db.from('events').select('payload,actor_id').eq('entity_id', opportunityId).eq('action', 'opportunity.created');
    expect(events![0]).toMatchObject({ actor_id: owner.userId, payload: { title: 'First project', amount_minor: 125050, stage_name: 'Discuss', stage_kind: 'open' } });
  });
  it('protects terminal uniqueness and historical classification even after moving away', async () => {
    await updateOpportunityStage(outsider.db, { organizationId: otherOrg, id: otherStage, name: 'Private stage', position: 0, kind: 'won' });
    expect((await listOpportunityStages(outsider.db, { organizationId: otherOrg }))[0].kind).toBe('won');
    await expect(createOpportunityStage(owner.db, { organizationId, name: 'Second win', position: 4, kind: 'won' })).rejects.toBeInstanceOf(Error);
    await expect(createOpportunityStage(owner.db, { organizationId, name: 'Second loss', position: 4, kind: 'lost' })).rejects.toBeInstanceOf(Error);
    await moveOpportunity(owner.db, { organizationId, opportunityId, stageId: lost });
    await expect(updateOpportunityStage(owner.db, { organizationId, id: won, name: 'Booked', position: 1, kind: 'open' })).rejects.toThrow(/cannot change/);
  });
  it('aggregates all rows exactly per currency, retaining empty stages and separating unstaged', async () => {
    for (const currency of ['USD', 'CAD']) await createOpportunity(owner.db, { organizationId, customerId, title: currency, stageId: open, amountMinor: 9007199254740991, currency });
    await createOpportunity(owner.db, { organizationId, customerId, title: 'Another USD', stageId: open, amountMinor: 9007199254740991, currency: 'USD' });
    const summary = await summarizeOpportunities(owner.db, { organizationId });
    expect(summary.find((stage) => stage.stageId === open)?.values).toEqual(expect.arrayContaining([{ currency: 'USD', amountMinor: '18014398509481982' }, { currency: 'CAD', amountMinor: '9007199254740991' }]));
    expect(summary.find((stage) => stage.stageId === won)?.count).toBe(0);
    expect(summary.find((stage) => stage.stageId === null)?.count).toBe(1);
    const filtered = await listOpportunities(owner.db, { organizationId, kind: 'open', search: 'USD', limit: 1 });
    expect(filtered).toHaveLength(1); expect(filtered.total).toBe(2);
    expect((await listOpportunities(owner.db, { organizationId, ownerMembershipId })).total).toBe(1);
  });
  it('enforces money pairing, minor units, dates and immutable Customer scope at the database', async () => {
    for (const fields of [{ amount_minor: 1, currency: null }, { amount_minor: -1, currency: 'CAD' }, { amount_minor: 1, currency: 'cad' }, { expected_close_on: '2027-02-30' }]) {
      expect((await owner.db.from('opportunities').insert({ organization_id: organizationId, customer_id: customerId, title: 'Invalid', created_by: owner.userId, ...fields })).error).not.toBeNull();
    }
    expect((await owner.db.from('opportunities').update({ customer_id: otherCustomer }).eq('id', opportunityId)).error).not.toBeNull();
    expect((await owner.db.from('opportunities').update({ organization_id: otherOrg }).eq('id', opportunityId)).error).not.toBeNull();
  });
  it('returns exact totals beyond a bounded page and refuses anonymous reads', async () => {
    const boundedCustomer = await createCustomer(owner.db, { organizationId, name: 'Large collection customer' });
    const inserted = await owner.db.from('opportunities').insert(Array.from({ length: 120 }, (_, index) => ({ organization_id: organizationId, customer_id: boundedCustomer, title: `Bounded ${index}`, stage_id: open, created_by: owner.userId })));
    expect(inserted.error).toBeNull();
    const first = await listOpportunities(owner.db, { organizationId, customerId: boundedCustomer });
    const next = await listOpportunities(owner.db, { organizationId, customerId: boundedCustomer, offset: 50 });
    expect(first.total).toBe(120); expect(first).toHaveLength(50);
    expect(next.total).toBe(120); expect(next).toHaveLength(50);
    expect(next.some((item) => first.some((previous) => previous.id === item.id))).toBe(false);
    expect((await summarizeOpportunities(owner.db, { organizationId })).find((stage) => stage.stageId === open)?.count).toBeGreaterThanOrEqual(120);
    const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
    const read = await anonymous.from('opportunities').select('id').eq('organization_id', organizationId);
    expect(read.data ?? []).toEqual([]);
    expect((await anonymous.from('opportunities').insert({ organization_id: organizationId, customer_id: customerId, title: 'Anonymous', created_by: owner.userId })).error).not.toBeNull();
  });
});
