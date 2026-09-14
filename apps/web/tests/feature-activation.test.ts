import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { listFeaturesByRuntimeMapping } from '@/lib/domain/catalogue/catalogue';
import {
  disableOrganizationFeature,
  enableOrganizationFeature,
  organizationResolvedFeatureStates,
  type ResolvedFeatureState,
} from '@/lib/domain/catalogue/organization-plans';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { assignRole, createRole, listRoles } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The four-axis feature resolver (domain-model.md): entitlement, activation, readiness, and —
 * proven by its absence from every assertion here — role authorization, which stays
 * `app.has_capability`'s question and never this resolver's.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function signUp(label: string): Promise<{ db: SupabaseClient; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, email };
}

let db: SupabaseClient;
let organizationId: string;
let ownerMembershipId: string;
let billingFeatureId: string;

async function billingState(): Promise<ResolvedFeatureState> {
  const states = await organizationResolvedFeatureStates(db, { organizationId });
  const state = states.find((s) => s.featureId === billingFeatureId);
  if (!state) throw new Error('billing-mapped feature not found in resolver output');
  return state;
}

describe('feature entitlement, activation and readiness', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    const owner = await signUp('feat');
    db = owner.db;
    organizationId = await foundBusiness({
      ownerEmail: owner.email,
      name: `Features ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      currency: 'EUR',
    });
    const { data } = await db
      .from('memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .single();
    ownerMembershipId = data!.id as string;

    const billingFeatures = await listFeaturesByRuntimeMapping(db, {
      mappingKind: 'module_key',
      mappingValue: 'billing',
    });
    if (billingFeatures.length === 0) throw new Error('no catalog feature maps to module_key billing');
    billingFeatureId = billingFeatures[0].id;
  });

  it('is entitled and active by default — opt-out, not opt-in', async () => {
    const state = await billingState();
    expect(state.entitled).toBe(true);
    expect(state.entitlementSource).toBe('legacy_module');
    expect(state.activation).toBe('active');
  });

  it('is setup_required, not off, when entitled but unconfigured', async () => {
    // A founding business is granted billing but starts with nothing priced.
    const state = await billingState();
    expect(state.readiness).toBe('setup_required');
    expect(state.reason).toBeTruthy();
  });

  it('becomes ready once the missing configuration exists, with no second calculation', async () => {
    await createPriceBookItem(db, {
      organizationId,
      name: 'A priced service',
      unit: 'visit',
      unitAmountMinor: 1_000,
    });
    const state = await billingState();
    expect(state.readiness).toBe('ready');
    expect(state.reason).toBeUndefined();
  });

  it('lets a tenant deliberately disable an entitled feature, and re-enable it', async () => {
    await disableOrganizationFeature(db, { organizationId, featureId: billingFeatureId });
    let state = await billingState();
    expect(state.activation).toBe('disabled');
    // Readiness is moot once disabled — the resolver still reports 'unavailable' rather than
    // pretending an inactive feature is ready.
    expect(state.readiness).toBe('unavailable');

    // Idempotent: disabling an already-disabled feature is not an error.
    await expect(
      disableOrganizationFeature(db, { organizationId, featureId: billingFeatureId }),
    ).resolves.toBeUndefined();

    await enableOrganizationFeature(db, { organizationId, featureId: billingFeatureId });
    state = await billingState();
    expect(state.activation).toBe('active');
    expect(state.readiness).toBe('ready');

    // Idempotent the other way too: enabling an already-active feature is not an error.
    await expect(
      enableOrganizationFeature(db, { organizationId, featureId: billingFeatureId }),
    ).resolves.toBeUndefined();
  });

  it('never lets an unentitled feature look enabled for lack of an override', async () => {
    const states = await organizationResolvedFeatureStates(db, { organizationId });
    const unentitled = states.find((s) => !s.entitled);
    expect(unentitled).toBeDefined();
    expect(unentitled!.activation).toBe('active');
    expect(unentitled!.readiness).toBe('unavailable');
  });

  it('refuses feature.manage to a role that does not hold it (I12), in the database', async () => {
    const noFeatureManage = await createRole(db, {
      organizationId,
      name: 'No Feature Manage',
      capabilities: ['role.manage'],
    });
    await assignRole(db, { membershipId: ownerMembershipId, roleId: noFeatureManage });

    await expect(
      disableOrganizationFeature(db, { organizationId, featureId: billingFeatureId }),
    ).rejects.toMatchObject({ code: 'organization_plans.feature_forbidden' });

    const roles = await listRoles(db, { organizationId });
    const admin = roles.find((r) => r.name === 'Admin')!;
    await assignRole(db, { membershipId: ownerMembershipId, roleId: admin.id });
  });
});
