import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer } from '@/lib/domain/customers/customers';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const connection = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let pg: Client;
let operator: SupabaseClient;
let outsider: SupabaseClient;
let stranger: SupabaseClient;
let operatorId: string;
let ownerId: string;
let organizationId: string;
let tenantId: string;
let otherTenantId: string;
let customerId: string;
let foreignCustomerId: string;
let relationshipId: string;

async function account() {
  const email = `services-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error) throw result.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { db, email, id: result.data.user.id };
}
beforeAll(async () => {
  pg = new Client(connection); await pg.connect();
  const seller = await account(); const tenant = await account(); const unrelated = await account();
  operator = seller.db; operatorId = seller.id; outsider = tenant.db;
  stranger = unrelated.db; ownerId = tenant.id;
  organizationId = await foundBusiness({ ownerEmail: seller.email, name: 'Service company', currency: 'CAD' });
  tenantId = await foundBusiness({ ownerEmail: tenant.email, name: 'Client tenant', currency: 'CAD' });
  otherTenantId = await foundBusiness({ ownerEmail: tenant.email, name: 'Other tenant', currency: 'CAD' });
  customerId = await createCustomer(operator, { organizationId, name: 'Client' });
  foreignCustomerId = await createCustomer(outsider, { organizationId: tenantId, name: 'Private customer' });
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)',[ownerId,'Authorized tenant-manager operator']);
  await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4',[organizationId,ownerId,'Tenant manager approver',operatorId]);
});
afterAll(async () => { await pg?.end(); });

describe('Client/Tenant relationship authority', () => {
  it('refuses ordinary seller membership and forged customer scope', async () => {
    expect((await operator.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: tenantId, p_authority_basis: 'Verified signed service agreement' })).error?.code).toBe('42501');
    await pg.query('insert into public.platform_staff(user_id,name) values($1,$2)', [operatorId, 'Verified operator']);
    expect((await operator.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: foreignCustomerId, p_tenant_id: tenantId, p_authority_basis: 'Verified signed service agreement' })).error?.code).toBe('42501');
    expect((await operator.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: tenantId, p_authority_basis: 'Forged approval note from platform staff' })).error?.code).toBe('42501');
    expect((await operator.rpc('existing_client_tenant_options',{p_organization_id:organizationId,p_customer_id:customerId})).data).toEqual([]);
  });
  it('records authorized tenant-manager approval without granting seller membership and rejects duplicate or missing target', async () => {
    const result = await outsider.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: tenantId, p_authority_basis: 'Verified signed service agreement ACME-42' });
    expect(result.error).toBeNull(); relationshipId = result.data;
    const approval = await operator.from('client_tenant_relationships').select('created_by,authority_basis').eq('organization_id',organizationId).eq('id',relationshipId).single();
    expect(approval.data?.created_by).toBe(ownerId);
    expect(approval.data?.authority_basis).toContain('Authenticated tenant-manager approval:');
    const duplicate = await outsider.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: tenantId, p_authority_basis: 'Verified signed service agreement ACME-42' });
    expect(duplicate.error?.code).toBe('23505');
    expect((await outsider.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: randomUUID(), p_authority_basis: 'Verified signed service agreement' })).error?.code).toBe('42501');
    expect((await pg.query('select * from memberships where organization_id=$1 and user_id=$2',[tenantId,operatorId])).rows).toHaveLength(0);
  });
  it('supports multiple tenants without transferring private access', async () => {
    expect((await outsider.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: otherTenantId, p_authority_basis: 'Verified second service agreement' })).error).toBeNull();
    expect((await operator.rpc('client_tenant_summaries', { p_organization_id: organizationId, p_customer_id: customerId })).data).toHaveLength(2);
    expect((await operator.from('customers').select('id').eq('organization_id',tenantId)).data).toHaveLength(0);
    const forgedWrite = await operator.from('customers').update({ name: 'Forged customer edit' }).eq('organization_id',tenantId).eq('id',foreignCustomerId).select('id');
    expect(forgedWrite.data ?? []).toEqual([]);
    const unchanged = await outsider.from('customers').select('name').eq('organization_id',tenantId).eq('id',foreignCustomerId).single();
    expect(unchanged.data?.name).toBe('Private customer');
    expect((await stranger.from('client_tenant_relationships').select('id').eq('organization_id',organizationId)).data).toHaveLength(0);
    expect((await stranger.rpc('end_client_tenant_relationship',{p_organization_id:organizationId,p_relationship_id:relationshipId})).error?.code).toBe('42501');
  });
  it('ends without deleting and relinking creates a new historical period', async () => {
    expect((await operator.rpc('end_client_tenant_relationship',{p_organization_id:organizationId,p_relationship_id:relationshipId})).error).toBeNull();
    const ended = await operator.from('client_tenant_relationships').select('*').eq('organization_id',organizationId).eq('id',relationshipId).single();
    expect(ended.data?.status).toBe('ended'); expect(ended.data?.ended_by).toBe(operatorId);
    expect((await pg.query('select id from organizations where id=$1',[tenantId])).rows).toHaveLength(1);
    const relink = await outsider.rpc('link_existing_client_tenant', { p_organization_id: organizationId, p_customer_id: customerId, p_tenant_id: tenantId, p_authority_basis: 'Verified renewed service agreement' });
    expect(relink.error).toBeNull(); expect(relink.data).not.toBe(relationshipId);
    expect((await operator.from('client_tenant_relationships').delete().eq('organization_id',organizationId)).error).not.toBeNull();
  });
  it('backfill is idempotent and unavailable to ordinary API callers', async () => {
    await pg.query('select app.backfill_handoff_relationships()');
    const before = await pg.query('select count(*) from client_tenant_relationships');
    await pg.query('select app.backfill_handoff_relationships()');
    expect((await pg.query('select count(*) from client_tenant_relationships')).rows).toEqual(before.rows);
    expect((await operator.from('client_tenant_relationships').update({status:'active'}).eq('organization_id',organizationId)).error).not.toBeNull();
    expect((await pg.query("select has_function_privilege('authenticated','app.backfill_handoff_relationships()','execute') as allowed")).rows[0].allowed).toBe(false);
  });
});
