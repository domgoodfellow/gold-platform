import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getBrand, setBrand } from '@/lib/domain/branding/brand';
import { listFeaturesByRuntimeMapping } from '@/lib/domain/catalogue/catalogue';
import {
  activeModuleKeys,
  availableFeatureKeys,
  disableOrganizationFeature,
  enableOrganizationFeature,
  organizationResolvedFeatureStates,
  recordPlanAssignment,
} from '@/lib/domain/catalogue/organization-plans';
import { createPlan, setPlanFeatureOverride } from '@/lib/domain/catalogue/plans';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import { addMember } from '@/lib/domain/tenancy/members';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { createRole } from '@/lib/domain/tenancy/roles';
import { workspaceConfigureItems } from '@/lib/navigation';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Two businesses, provisioned the way a real one is, each with its own owner, branding,
 * timezone, entitlements and records — and the proof that one cannot see or change the other,
 * that platform staff are not members of either, and that what a plan grants (and a role may
 * configure) decides what is offered. Every user-facing action goes through a signed-in client
 * under row-level security; the service role only creates the accounts the owners sign in with.
 *
 * Tenant A is a customer-service business (assistant entitled). Tenant B is a field-service
 * business (assistant not purchased).
 */

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; email: string; password: string; organizationId: string; userId: string };

async function account(label: string) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { db, email, password, userId: created.data.user.id };
}

async function tenant(label: string, input: { name: string; currency: string; timezone: string }): Promise<Tenant> {
  const owner = await account(label);
  const organizationId = await foundBusiness({ ownerEmail: owner.email, ...input });
  return { ...owner, organizationId };
}

let staff: SupabaseClient;
let staffUserId: string;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  if (!ANON || !SERVICE) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  staff = await asPlatformStaff();
  staffUserId = (await staff.auth.getUser()).data.user!.id;
  [a, b] = await Promise.all([
    tenant('cs-owner', { name: 'Harbourline Support Co', currency: 'CAD', timezone: 'America/Toronto' }),
    tenant('fs-owner', { name: 'Prairie Mobile Mechanics', currency: 'CAD', timezone: 'America/Edmonton' }),
  ]);
}, 120_000);

describe('provisioning gives each business its own owner, settings and boundary', () => {
  it('created two organizations with their own name, currency and timezone', async () => {
    const mineA = (await listMyOrganizations(a.db)).find((organization) => organization.id === a.organizationId)!;
    const mineB = (await listMyOrganizations(b.db)).find((organization) => organization.id === b.organizationId)!;
    expect(mineA).toMatchObject({ name: 'Harbourline Support Co', currency: 'CAD', timezone: 'America/Toronto' });
    expect(mineB).toMatchObject({ name: 'Prairie Mobile Mechanics', currency: 'CAD', timezone: 'America/Edmonton' });
    // The owner of one business does not so much as see the other in their own list.
    expect((await listMyOrganizations(a.db)).some((organization) => organization.id === b.organizationId)).toBe(false);
    expect((await listMyOrganizations(b.db)).some((organization) => organization.id === a.organizationId)).toBe(false);
  });

  it('does not make the platform operator a member of the business they provisioned', async () => {
    for (const tenantId of [a.organizationId, b.organizationId]) {
      const membership = await staff.from('memberships').select('id').eq('organization_id', tenantId).eq('user_id', staffUserId);
      expect(membership.data ?? []).toEqual([]);
    }
    // And, as a non-member, staff cannot read a business's customers through the ordinary tables.
    await createCustomer(a.db, { organizationId: a.organizationId, name: 'Staff must not see me' });
    expect((await staff.from('customers').select('id').eq('organization_id', a.organizationId)).data ?? []).toEqual([]);
  });

  it('carries no records, brand or configuration from one business to the next', async () => {
    expect(await listCustomers(b.db, { organizationId: b.organizationId })).toEqual([]);
    expect((await getBrand(b.db, { organizationId: b.organizationId })).accent).toBeNull();
  });
});

describe('tenant isolation under ordinary authentication', () => {
  it("does not let one owner read, change or delete the other's customers", async () => {
    const mine = await createCustomer(a.db, { organizationId: a.organizationId, name: 'A-only customer' });
    const theirs = await createCustomer(b.db, { organizationId: b.organizationId, name: 'B-only customer' });

    expect((await a.db.from('customers').select('id').eq('id', theirs)).data ?? []).toEqual([]);
    expect((await b.db.from('customers').select('id').eq('id', mine)).data ?? []).toEqual([]);

    const update = await a.db.from('customers').update({ name: 'hijacked' }).eq('id', theirs).select('id');
    expect(update.data ?? []).toEqual([]);
    const removal = await a.db.from('customers').delete().eq('id', theirs).select('id');
    expect(removal.data ?? []).toEqual([]);

    const untouched = await b.db.from('customers').select('name').eq('id', theirs).single();
    expect(untouched.data?.name).toBe('B-only customer');
    // Writing into the other business by naming its id is refused outright.
    await expect(createCustomer(a.db, { organizationId: b.organizationId, name: 'planted' })).rejects.toBeInstanceOf(Error);
  });

  it("does not let one owner configure the other's business", async () => {
    await expect(setBrand(a.db, { organizationId: b.organizationId, accent: '#ff0000', headingFont: 'sans', bodyFont: 'sans' })).rejects.toMatchObject({ code: 'brand.forbidden' });
    expect((await getBrand(b.db, { organizationId: b.organizationId })).accent).toBeNull();
  });

  it("keeps each business's saved branding its own", async () => {
    await setBrand(a.db, { organizationId: a.organizationId, accent: '#0f766e', headingFont: 'serif', bodyFont: 'sans' });
    await setBrand(b.db, { organizationId: b.organizationId, accent: '#c2410c', headingFont: 'sans', bodyFont: 'mono' });
    expect(await getBrand(a.db, { organizationId: a.organizationId })).toMatchObject({ accent: '#0f766e', headingFont: 'serif', bodyFont: 'sans' });
    expect(await getBrand(b.db, { organizationId: b.organizationId })).toMatchObject({ accent: '#c2410c', headingFont: 'sans', bodyFont: 'mono' });
    // Neither can read the other's settings row directly.
    expect((await a.db.from('brand_settings').select('accent').eq('organization_id', b.organizationId)).data ?? []).toEqual([]);
  });

  it('shows an unauthenticated visitor none of either business', async () => {
    const visitor = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const table of ['customers', 'work_items', 'memberships', 'ai_assistants', 'brand_settings']) {
      const result = await visitor.from(table).select('*').in('organization_id', [a.organizationId, b.organizationId]);
      expect(result.data ?? [], table).toEqual([]);
    }
  });
});

describe('what a plan grants decides what is offered, and a role decides who may configure it', () => {
  let assistantFeatureIds: string[] = [];

  beforeAll(async () => {
    assistantFeatureIds = (await listFeaturesByRuntimeMapping(staff, { mappingKind: 'module_key', mappingValue: 'assistant' })).map((feature) => feature.id);
    expect(assistantFeatureIds.length).toBeGreaterThan(0);
    const planId = await createPlan(staff, { key: `cs_${randomUUID().slice(0, 8)}`, kind: 'plan', label: 'Acceptance customer service', description: 'Controlled acceptance fixture', billable: false });
    for (const featureId of assistantFeatureIds) await setPlanFeatureOverride(staff, { planId, featureId, included: true });
    await recordPlanAssignment(staff, { organizationId: a.organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
  }, 60_000);

  const assistantEntitled = async (tenantUnderTest: Tenant) => {
    const states = await organizationResolvedFeatureStates(tenantUnderTest.db, { organizationId: tenantUnderTest.organizationId });
    return states.filter((state) => state.moduleKey === 'assistant').some((state) => state.entitled);
  };

  it('entitles the assistant for the business that bought it and not for the other', async () => {
    expect(await assistantEntitled(a)).toBe(true);
    expect(await assistantEntitled(b)).toBe(false);
  });

  it('offers AI configuration doors only where the plan and the role both allow them', async () => {
    const gateFor = async (tenantUnderTest: Tenant, capabilities: string[]) => {
      const states = await organizationResolvedFeatureStates(tenantUnderTest.db, { organizationId: tenantUnderTest.organizationId });
      return {
        enabledModules: new Set(activeModuleKeys(states)),
        featureAvailability: new Set(availableFeatureKeys(states)),
        capabilities: new Set(capabilities) as never,
      };
    };
    const owner = ['organization.manage'];
    // Permission without entitlement: nothing. Entitlement without permission: nothing.
    expect(workspaceConfigureItems(b.organizationId, 'ai', await gateFor(b, owner))).toEqual([]);
    expect(workspaceConfigureItems(a.organizationId, 'ai', await gateFor(a, []))).toEqual([]);
    // The record decides what is actually *available*: report it rather than assume it.
    const items = workspaceConfigureItems(a.organizationId, 'ai', await gateFor(a, owner));
    for (const item of items) expect(item.href.startsWith(`/organizations/${a.organizationId}/`)).toBe(true);
  });

  it('lets a manager configure and refuses a reduced-permission member, on the server', async () => {
    const manager = await account('cs-manager');
    const member = await account('cs-member');
    const managerRole = await createRole(a.db, { organizationId: a.organizationId, name: 'Acceptance manager', capabilities: ['organization.manage'] });
    const memberRole = await createRole(a.db, { organizationId: a.organizationId, name: 'Acceptance reader', capabilities: ['customer.update'] });
    await addMember(a.db, { organizationId: a.organizationId, email: manager.email, roleId: managerRole });
    await addMember(a.db, { organizationId: a.organizationId, email: member.email, roleId: memberRole });

    await expect(setBrand(manager.db, { organizationId: a.organizationId, accent: '#1d4ed8', headingFont: 'sans', bodyFont: 'sans' })).resolves.toBeUndefined();
    await expect(setBrand(member.db, { organizationId: a.organizationId, accent: '#dc2626', headingFont: 'sans', bodyFont: 'sans' })).rejects.toMatchObject({ code: 'brand.forbidden' });
    expect((await getBrand(a.db, { organizationId: a.organizationId })).accent).toBe('#1d4ed8');

    // The manager is a member of A only; B is invisible to them.
    expect((await listMyOrganizations(manager.db)).map((organization) => organization.id)).toEqual([a.organizationId]);
    expect(await listCustomers(manager.db, { organizationId: b.organizationId })).toEqual([]);
  }, 60_000);

  it('turns a feature off and on through its canonical authority without losing the business\'s data', async () => {
    const states = await organizationResolvedFeatureStates(a.db, { organizationId: a.organizationId });
    const feature = states.find((state) => state.moduleKey === 'assistant' && state.entitled && state.activation === 'active' && state.implementationState === 'available');
    expect(feature, 'the entitled assistant feature is available and active to toggle').toBeDefined();
    if (!feature) return;

    const agent = await a.db.rpc('save_ai_assistant', { p_organization_id: a.organizationId, p_id: null, p_name: 'Acceptance agent', p_instructions: 'Answer published questions.', p_configuration: { policy: 'read_only', tools: [] }, p_expected_draft: null });
    expect(agent.error).toBeNull();

    await disableOrganizationFeature(a.db, { organizationId: a.organizationId, featureId: feature.featureId });
    const off = (await organizationResolvedFeatureStates(a.db, { organizationId: a.organizationId })).find((state) => state.featureId === feature.featureId);
    expect(off?.activation).not.toBe('active');
    // The business's agent is still there to read; only availability changed.
    expect((await a.db.from('ai_assistants').select('id').eq('id', agent.data)).data).toHaveLength(1);

    await enableOrganizationFeature(a.db, { organizationId: a.organizationId, featureId: feature.featureId });
    const on = (await organizationResolvedFeatureStates(a.db, { organizationId: a.organizationId })).find((state) => state.featureId === feature.featureId);
    expect(on?.activation).toBe('active');
    // And the other business was never touched by either.
    expect(await assistantEntitled(b)).toBe(false);
  }, 60_000);
});
