import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { createRole, assignRole } from '@/lib/domain/tenancy/roles';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers, getCustomer, updateCustomer, listCustomerPage, listCustomerLastActivity } from '@/lib/domain/customers/customers';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Customer is the first genuinely tenant-owned entity, so this is where the earlier-prototype failure
 * gets its regression test:
 *
 *   > Its `customers_email_unique` is global too, so two tenants could never share a
 *   > customer email address.
 *
 * Two businesses serving the same person is ordinary. If SHARED_EMAIL ever fails for the
 * second tenant, the unique index has lost its leading organization_id.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SHARED_EMAIL = `shared-${randomUUID().slice(0, 8)}@example.test`;

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

describe('customers', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('alice');
    bob = await newTenant('bob');
  });

  it('lets two tenants hold the same customer email address', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Shared Person',
        email: SHARED_EMAIL,
      }),
    ).resolves.toBeTypeOf('string');

    // The assertion the prior repo would have failed.
    await expect(
      createCustomer(bob.db, {
        organizationId: bob.organizationId,
        name: 'Shared Person',
        email: SHARED_EMAIL,
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses the same email twice within one tenant', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Shared Person Again',
        email: SHARED_EMAIL.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: 'customers.email_taken' });
  });

  it('shows each tenant only its own customers', async () => {
    const forAlice = await listCustomers(alice.db, { organizationId: alice.organizationId });
    const forBob = await listCustomers(bob.db, { organizationId: bob.organizationId });

    expect(forAlice).toHaveLength(1);
    expect(forBob).toHaveLength(1);
    expect(forAlice[0].id).not.toBe(forBob[0].id);
  });

  it('returns nothing when asked for another tenant by id', async () => {
    const stolen = await listCustomers(alice.db, { organizationId: bob.organizationId });
    expect(stolen).toEqual([]);
  });

  it('refuses to create a customer inside another tenant', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: bob.organizationId,
        name: 'Trojan',
        email: `trojan-${randomUUID().slice(0, 8)}@example.test`,
      }),
    ).rejects.toMatchObject({ code: 'customers.create_failed' });

    const forBob = await listCustomers(bob.db, { organizationId: bob.organizationId });
    expect(forBob.map((c) => c.name)).not.toContain('Trojan');
  });

  it('writes a timeline event attributable to its author', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('actor_id, entity_type, entity_id, action')
      .eq('entity_type', 'customer');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].actor_id).toBe(alice.userId);
    expect(data![0].action).toBe('customer.created');
  });

  it('rolls the event back with the customer when creation fails', async () => {
    const before = await alice.db.from('events').select('id').eq('entity_type', 'customer');

    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Doomed',
        email: SHARED_EMAIL,
      }),
    ).rejects.toBeInstanceOf(Error);

    const after = await alice.db.from('events').select('id').eq('entity_type', 'customer');
    expect(after.data).toHaveLength(before.data!.length);
  });

  it('rejects a nameless customer in the domain, before the database', async () => {
    await expect(
      createCustomer(alice.db, { organizationId: alice.organizationId, name: '   ' }),
    ).rejects.toMatchObject({ code: 'customers.name_required' });
  });
});

describe('contact lifecycle and temperature', () => {
  it('keeps identity and history through independent classification changes', async () => {
    const id = await createCustomer(alice.db, {organizationId:alice.organizationId,name:'Classification fixture'});
    expect(await getCustomer(alice.db,{organizationId:alice.organizationId,customerId:id})).toMatchObject({id,lifecycle:null,leadTemperature:'unrated'});
    for (const [lifecycle,leadTemperature] of [['lead','hot'],['prospect','hot'],['customer','cold']] as const) {
      await updateCustomer(alice.db,{organizationId:alice.organizationId,customerId:id,name:'Classification fixture',lifecycle,leadTemperature});
      expect(await getCustomer(alice.db,{organizationId:alice.organizationId,customerId:id})).toMatchObject({id,lifecycle,leadTemperature,stageId:null});
    }
    const filtered = await listCustomerPage(alice.db,{organizationId:alice.organizationId,filter:{page:1,search:'Classification',lifecycle:'customer',temperature:'cold'}});
    expect(filtered.map(contact => contact.id)).toEqual([id]);
    const events=await alice.db.from('events').select('action').eq('organization_id',alice.organizationId).eq('entity_id',id);
    expect(events.data?.filter(event=>event.action==='customer.classification_changed')).toHaveLength(3);
    const history=await listCustomerTimeline(alice.db,{organizationId:alice.organizationId,customerId:id});
    expect(history.filter(entry=>entry.action==='customer.classification_changed')).toHaveLength(3);
    expect(history.map(entry=>entry.description)).toContain('Lifecycle: Customer; lead temperature: Cold');
    expect((await listCustomerLastActivity(alice.db,{organizationId:alice.organizationId,customerIds:[id]}))[id]).toBeTruthy();
    expect(await listCustomerLastActivity(bob.db,{organizationId:alice.organizationId,customerIds:[id]})).toEqual({});
    await expect(updateCustomer(bob.db,{organizationId:alice.organizationId,customerId:id,name:'Foreign change',lifecycle:'lead'})).rejects.toMatchObject({code:'customers.update_refused'});
    const invalid = await alice.db.rpc('update_contact',{p_organization_id:alice.organizationId,p_customer_id:id,p_name:'Classification fixture',p_email:null,p_phone:null,p_custom:{},p_stage_id:null,p_lifecycle:'won',p_lead_temperature:'hot'});
    expect(invalid.error?.code).toBe('23514');
    expect(await getCustomer(alice.db,{organizationId:alice.organizationId,customerId:id})).toMatchObject({id,lifecycle:'customer',leadTemperature:'cold'});
  });
});

describe('contact command authority',()=>{
  it('allows creation with classification without granting later editing authority',async()=>{
    const creator=await newTenant('classification-creator');
    const roleId=await createRole(creator.db,{organizationId:creator.organizationId,name:'Create without editing',capabilities:['customer.create','role.manage']});
    const membership=await creator.db.from('memberships').select('id').eq('organization_id',creator.organizationId).single();
    await assignRole(creator.db,{membershipId:membership.data!.id,roleId});
    const id=await createCustomer(creator.db,{organizationId:creator.organizationId,name:'Create only contact',lifecycle:'prospect',leadTemperature:'hot'});
    expect(await getCustomer(creator.db,{organizationId:creator.organizationId,customerId:id})).toMatchObject({id,lifecycle:'prospect',leadTemperature:'hot'});
    await expect(updateCustomer(creator.db,{organizationId:creator.organizationId,customerId:id,name:'Denied edit',lifecycle:'customer'})).rejects.toMatchObject({code:'customers.update_refused'});
  });
});


describe('canonical person and company identity', () => {
  it('preserves independent identities, affiliations, filters, and tenant isolation', async () => {
    const {createContact,getContact,listContactPage}=await import('@/lib/domain/contacts/contacts');
    const organizationId=alice.organizationId;
    const company=await createContact(alice.db,{organizationId,name:'Canonical company',contactType:'company',lifecycle:'customer'});
    const person=await createContact(alice.db,{organizationId,name:'Canonical person',contactType:'person',companyId:company,affiliationTitle:'Director'});
    const second=await createContact(alice.db,{organizationId,name:'Canonical second',contactType:'person',companyId:company});
    const other=await createContact(alice.db,{organizationId,name:'Other employer',contactType:'company'});
    const linked=await alice.db.rpc('save_contact_affiliation',{p_organization_id:organizationId,p_person_id:person,p_company_id:other,p_title:'Advisor',p_active:false});
    expect(linked.error).toBeNull();
    expect(await getContact(alice.db,{organizationId,customerId:company})).toMatchObject({id:company,contactType:'company',lifecycle:'customer'});
    expect(await getContact(alice.db,{organizationId,customerId:person})).toMatchObject({id:person,contactType:'person',lifecycle:null});
    const legacy=await alice.db.from('customers').select('id').eq('id',company).single();expect(legacy.data?.id).toBe(company);
    const affiliations=await alice.db.from('contact_affiliations').select('*').eq('organization_id',organizationId).eq('company_id',company);
    expect(affiliations.data?.map(row=>row.person_id).sort()).toEqual([person,second].sort());
    const people=await listContactPage(alice.db,{organizationId,filter:{page:1,contactType:'person',companyId:company,sort:'name'}});
    expect(people.map(row=>row.id).sort()).toEqual([person,second].sort());
    expect(await bob.db.from('contact_affiliations').select('*').eq('organization_id',organizationId)).toMatchObject({data:[],error:null});
    const refused=await bob.db.rpc('save_contact_affiliation',{p_organization_id:organizationId,p_person_id:person,p_company_id:company});expect(refused.error).not.toBeNull();
    const wrongType=await alice.db.rpc('save_contact_affiliation',{p_organization_id:organizationId,p_person_id:company,p_company_id:other});expect(wrongType.error).not.toBeNull();
    const details=await alice.db.from('contact_people').select('contact_id').eq('contact_id',person).single();expect(details.data?.contact_id).toBe(person);
    const legacyId=await createCustomer(alice.db,{organizationId,name:'Unspecified legacy'});
    expect(await getContact(alice.db,{organizationId,customerId:legacyId})).toMatchObject({id:legacyId,contactType:'unspecified'});
    await updateCustomer(alice.db,{organizationId,customerId:legacyId,name:'Classified legacy',contactType:'company'});
    expect(await getContact(alice.db,{organizationId,customerId:legacyId})).toMatchObject({id:legacyId,contactType:'company'});
    // Classification happens once; a typed identity never changes kind afterwards.
    await expect(updateCustomer(alice.db,{organizationId,customerId:legacyId,name:'Classified legacy',contactType:'person'})).rejects.toThrow();
    expect(await getContact(alice.db,{organizationId,customerId:legacyId})).toMatchObject({id:legacyId,contactType:'company'});
  });
});
