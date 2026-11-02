import { randomUUID } from 'node:crypto';
import { seedLegacyPlanProposal } from '@/tests/support/legacy-proposals';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlan } from '@/lib/domain/catalogue/plans';
import { acceptCommercialProposal, markCommercialProposalSent } from '@/lib/domain/customers/commercial-proposals';
import { createCustomer, getCustomer } from '@/lib/domain/customers/customers';
import { upsertDiscoverySnapshotAnswers } from '@/lib/domain/customers/discovery-snapshots';
import { claimProposalInvite, createProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { getFoundingHandoff, getProposalHandoff, handoffAcceptedProposal } from '@/lib/domain/customers/proposal-handoff';
import { currentPlanAssignment, listOrganizationPlanAgreements } from '@/lib/domain/catalogue/organization-plans';
import { computeReadiness, launchOrganization } from '@/lib/domain/tenancy/lifecycle';
import { requireOrganization, requireOrganizationForBillingRecovery, serviceLockedHref } from '@/lib/route/organization';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';
import { applySubscriptionEvent } from '@/tests/support/subscription-events';

// The route guards, observed as thrown values; `getDb` returns whichever signed-in client the test names.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
let currentDb: SupabaseClient;
vi.mock('@/lib/db/server', () => ({ getDb: async () => currentDb }));

/**
 * Slice 10: "Create this business in GildOps," from an accepted proposal. Proves the terminal
 * boundary this repo's own the one-creation-path rule already drew: only platform staff may provision, the original
 * GildOps customer record is untouched, and a second handoff attempt returns the original
 * business and relationship period rather than creating a second business for one acceptance.
 *
 * The reads this function makes (the proposal, the customer, the discovery snapshot) need
 * ordinary GildOps organization membership; the provisioning write needs genuine platform staff
 * authority. One person plausibly holds both (the one-identity rule: "one identity, capable of holding platform
 * authority and organization membership at once"), so the caller here is promoted to staff on
 * top of the membership `foundBusiness` already gave it, rather than a separate staff-only
 * session that could never pass the read side at all.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

describe('handing off an accepted proposal', () => {
  let gildOpsOrgId: string;
  let repDb: SupabaseClient;
  let repUserId: string;
  let customerId: string;
  let acceptedProposalId: string;
  let ownerEmail: string;
  let ownerPassword: string;
  let planId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const repEmail = `rep-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { data: repUser, error: createError } = await admin.auth.admin.createUser({ email: repEmail, password, email_confirm: true });
    if (createError) throw createError;
    repUserId = repUser.user.id;

    repDb = anonClient();
    const { error: signInError } = await repDb.auth.signInWithPassword({ email: repEmail, password });
    if (signInError) throw signInError;

    gildOpsOrgId = (await foundBusiness({ ownerEmail: repEmail, name: 'GildOps (test)', currency: 'CAD' })) as string;

    // The prospect's own owner-to-be must already have an account (provision_organization's own
    // precondition) — a real one, not anonymous, and reachable by an email on the customer row.
    ownerEmail = `owner-${randomUUID().slice(0, 8)}@example.test`;
    ownerPassword = `pw-${randomUUID()}`;
    const { error: ownerCreateError } = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
    if (ownerCreateError) throw ownerCreateError;

    customerId = await createCustomer(repDb, { organizationId: gildOpsOrgId, name: 'Handoff Prospect Co', email: ownerEmail });
    await upsertDiscoverySnapshotAnswers(repDb, {
      organizationId: gildOpsOrgId,
      customerId,
      patch: { bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner' } },
    });

    const start = await getPlan(repDb, 'start');
    planId = start!.id;
    const built = await seedLegacyPlanProposal({ createdBy: repUserId,
      organizationId: gildOpsOrgId,
      customerId,
      planId: start!.id,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });
    await markCommercialProposalSent(repDb, { organizationId: gildOpsOrgId, proposalId: built.id });

    const token = await createProposalInvite(repDb, { customerId });
    const visitor = anonClient();
    await claimProposalInvite(visitor, { token });
    await acceptCommercialProposal(visitor, { proposalId: built.id });

    acceptedProposalId = built.id;
  });

  it('refuses a caller who is not platform staff', async () => {
    await expect(
      handoffAcceptedProposal(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId }),
    ).rejects.toMatchObject({ code: 'proposal_handoff.not_staff' });
  });

  it('refuses a direct RPC for a real accepted proposal without seller customer authority', async () => {
    const staff = await asPlatformStaff();
    const result = await staff.rpc('hand_off_accepted_proposal', { p_proposal_id: acceptedProposalId });
    expect(result.error?.code).toBe('42501');
    expect(await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId })).toBeNull();
  });

  it('creates the business with organization authority alone and leaves the seller customer untouched', async () => {
    // Promote the same, already-signed-in rep to platform staff — live-checked, so no
    // re-sign-in is needed for it to take effect on this session's next request.
    const pg = new Client(CONNECTION);
    await pg.connect();
    await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [
      repUserId, 'Rep (test staff)', ['platform.organizations'],
    ]);
    await pg.end();

    const handoff = await handoffAcceptedProposal(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });

    expect(handoff.createdOrganizationId).not.toBe(gildOpsOrgId);
    expect(handoff.customerId).toBe(customerId);
    expect(handoff.proposalId).toBe(acceptedProposalId);
    expect(handoff.discoverySnapshot.bookingIntake?.value).toBe('Books online.');
    expect(handoff.commercialTerms).toMatchObject({ planId: expect.any(String), currency: 'CAD', billingInterval: 'month' });

    // The original GildOps prospect record: same id, same organization, untouched.
    const stillThere = await getCustomer(repDb, { organizationId: gildOpsOrgId, customerId });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.name).toBe('Handoff Prospect Co');

    const { data: newOrg } = await repDb.from('organizations').select('id, name').eq('id', handoff.createdOrganizationId).maybeSingle();
    expect(newOrg?.name).toBe('Handoff Prospect Co');
  });

  it('is idempotent: a second call for the same proposal returns the same business rather than creating another', async () => {
    const first = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const second = await handoffAcceptedProposal(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });

    expect(second.createdOrganizationId).toBe(first!.createdOrganizationId);
    const relationships = await repDb.from('client_tenant_relationships').select('id,originating_handoff_id,tenant_organization_id')
      .eq('organization_id', gildOpsOrgId).eq('originating_handoff_id', first!.id);
    expect(relationships.error).toBeNull();
    expect(relationships.data).toHaveLength(1);
    expect(relationships.data![0].tenant_organization_id).toBe(first!.createdOrganizationId);
    expect(second.id).toBe(first!.id);

    const { count } = await repDb
      .from('customer_proposal_handoffs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', gildOpsOrgId)
      .eq('proposal_id', acceptedProposalId);
    expect(count).toBe(1);
  });

  it('reads the handoff back by proposal id', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    expect(handoff).not.toBeNull();
    expect(handoff!.proposalId).toBe(acceptedProposalId);
  });

  it('snapshots accepted terms and validates the Customer of commercial origins', async () => {
    const result = await repDb.rpc('create_service_engagement', { p_organization_id: gildOpsOrgId, p_customer_id: customerId, p_name: 'Accepted implementation', p_service_kind: 'implementation', p_proposal_id: acceptedProposalId });
    expect(result.error).toBeNull();
    const row = await repDb.from('service_engagements').select('accepted_terms,proposal_id').eq('organization_id', gildOpsOrgId).eq('id', result.data).single();
    expect(row.data?.accepted_terms).toMatchObject({ currency: 'CAD', planId, version: 1 });
    const otherCustomer = await createCustomer(repDb, { organizationId: gildOpsOrgId, name: 'Unrelated service customer' });
    expect((await repDb.rpc('create_service_engagement', { p_organization_id: gildOpsOrgId, p_customer_id: otherCustomer, p_name: 'Forged origin', p_service_kind: 'implementation', p_proposal_id: acceptedProposalId })).error?.code).toBe('42501');
  });

  it('backfills authoritative legacy handoffs with provenance and safely repeats', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      await pg.query('delete from public.client_tenant_relationships where organization_id=$1 and originating_handoff_id=$2', [gildOpsOrgId, handoff!.id]);
      await pg.query('select app.backfill_handoff_relationships()');
      await pg.query('select app.backfill_handoff_relationships()');
      const result = await pg.query('select * from public.client_tenant_relationships where organization_id=$1 and originating_handoff_id=$2', [gildOpsOrgId, handoff!.id]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ id: handoff!.id, customer_id: customerId, tenant_organization_id: handoff!.createdOrganizationId, created_by: handoff!.createdBy, origin: 'proposal_handoff' });
      expect(result.rows[0].created_at.toISOString()).toBe(new Date(handoff!.createdAt).toISOString());
      const conflictingCustomer = await createCustomer(repDb, { organizationId: gildOpsOrgId, name: 'Conflicting legacy customer' });
      await pg.query('begin');
      await pg.query('update client_tenant_relationships set customer_id=$1 where organization_id=$2 and originating_handoff_id=$3', [conflictingCustomer, gildOpsOrgId, handoff!.id]);
      await expect(pg.query('select app.backfill_handoff_relationships()')).rejects.toMatchObject({ code: '23514' });
      await pg.query('rollback');
    } finally { await pg.end(); }
  });

  it('a repeated handoff never reactivates an ended relationship or deletes its founding history', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const result = await repDb.from('client_tenant_relationships').select('id').eq('organization_id', gildOpsOrgId).eq('originating_handoff_id', handoff!.id).single();
    expect((await repDb.rpc('end_client_tenant_relationship', { p_organization_id: gildOpsOrgId, p_relationship_id: result.data!.id })).error).toBeNull();
    await handoffAcceptedProposal(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const rows = await repDb.from('client_tenant_relationships').select('status').eq('organization_id', gildOpsOrgId).eq('originating_handoff_id', handoff!.id);
    expect(rows.data).toEqual([{ status: 'ended' }]);
    expect((await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId }))!.id).toBe(handoff!.id);
  });

  it('entitles the created business to the accepted Plan, at the accepted price', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const createdOrganizationId = handoff!.createdOrganizationId;

    expect(await currentPlanAssignment(repDb, { organizationId: createdOrganizationId })).toBeNull();
    const ownerDb = anonClient();
    const signedIn = await ownerDb.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    expect(signedIn.error).toBeNull();
    const assignment = await currentPlanAssignment(ownerDb, { organizationId: createdOrganizationId });
    expect(assignment).not.toBeNull();
    expect(assignment!.planId).toBe(planId);
    expect(assignment!.periodEnd).toBe('9999-12-31');

    const agreements = await listOrganizationPlanAgreements(ownerDb, { organizationId: createdOrganizationId, planId });
    expect(agreements).toHaveLength(1);
    expect(agreements[0].currency).toBe('CAD');
    expect(agreements[0].amountMinor).toBeGreaterThan(0);
  });

  it('the founded business can read its own handoff; an unrelated third organization cannot', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const createdOrganizationId = handoff!.createdOrganizationId;

    const ownerDb = anonClient();
    const { error: signInError } = await ownerDb.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    if (signInError) throw signInError;

    const foundersOwnRead = await getFoundingHandoff(ownerDb, { organizationId: createdOrganizationId });
    expect(foundersOwnRead).not.toBeNull();
    expect(foundersOwnRead!.id).toBe(handoff!.id);
    expect(foundersOwnRead!.createdOrganizationId).toBe(createdOrganizationId);

    // A third organization, member of neither the selling org nor the one this handoff founded —
    // RLS refuses it the row entirely, not merely the query's own `created_organization_id` filter.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const strangerEmail = `stranger-${randomUUID().slice(0, 8)}@example.test`;
    const strangerPassword = `pw-${randomUUID()}`;
    const { error: strangerCreateError } = await admin.auth.admin.createUser({
      email: strangerEmail,
      password: strangerPassword,
      email_confirm: true,
    });
    if (strangerCreateError) throw strangerCreateError;
    const strangerOrgId = (await foundBusiness({ ownerEmail: strangerEmail, name: 'Unrelated Co', currency: 'CAD' })) as string;

    const strangerDb = anonClient();
    const { error: strangerSignInError } = await strangerDb.auth.signInWithPassword({ email: strangerEmail, password: strangerPassword });
    if (strangerSignInError) throw strangerSignInError;

    expect(await getFoundingHandoff(strangerDb, { organizationId: createdOrganizationId })).toBeNull();
    expect(strangerOrgId).not.toBe(createdOrganizationId);
  });

  it('refuses to hand off a proposal that was never accepted', async () => {
    const start = await getPlan(repDb, 'start');
    const draft = await seedLegacyPlanProposal({ createdBy: repUserId,
      organizationId: gildOpsOrgId,
      customerId,
      planId: start!.id,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });

    await expect(
      handoffAcceptedProposal(repDb, { organizationId: gildOpsOrgId, proposalId: draft.id }),
    ).rejects.toMatchObject({ code: 'proposal_handoff.not_accepted' });
  });

  /**
   * The defect this slice closes. A Sales-founded business holds a billable Plan the moment it
   * exists (the handoff entitles it) but no subscription — checkout is the owner's own act, later.
   * `requireOrganization` used to read that as a lock, so the owner could never reach Setup.
   * No subscription row is inserted to get past it: the owner is simply let in, and Launch is
   * what asks for payment.
   */
  it('lets the founded owner into Setup with no subscription, and asks for payment at Launch', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const orgId = handoff!.createdOrganizationId;
    process.env.STRIPE_SECRET_KEY = 'sk_test_handoff_suite';

    const ownerDb = anonClient();
    const { error } = await ownerDb.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    if (error) throw error;
    currentDb = ownerDb;

    // Entitled, billable, unsubscribed, in Setup — the exact state that used to lock.
    expect((await currentPlanAssignment(ownerDb, { organizationId: orgId }))!.planId).toBe(planId);
    const { count } = await ownerDb
      .from('organization_platform_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    expect(count).toBe(0);

    await expect(requireOrganization(orgId)).resolves.toBeTruthy();
    const { access, organization } = await requireOrganizationForBillingRecovery(orgId);
    expect(organization.operationalState).toBe('setup');
    expect(access).toMatchObject({ permitted: true, code: 'subscription_pending_setup' });

    // Distinct from READY and LIVE: Setup is open, Launch is not.
    const readiness = await computeReadiness(ownerDb, { organizationId: orgId });
    expect(readiness.blockers.map((b) => b.key)).toContain('subscription');
    await expect(launchOrganization(ownerDb, { organizationId: orgId })).rejects.toMatchObject({
      code: 'organizations.not_ready',
    });
    expect((await requireOrganizationForBillingRecovery(orgId)).organization.operationalState).toBe('setup');
  }, 60_000);

  it('launches once a subscription is serviceable, and locks a launched business whose subscription lapses', async () => {
    const handoff = await getProposalHandoff(repDb, { organizationId: gildOpsOrgId, proposalId: acceptedProposalId });
    const orgId = handoff!.createdOrganizationId;
    const ownerDb = anonClient();
    const { data: signedIn, error } = await ownerDb.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    if (error) throw error;
    currentDb = ownerDb;

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const customerReference = `cus_${randomUUID().slice(0, 12)}`;
      await pg.query(
        `insert into public.platform_billing_customers (organization_id, environment, customer_reference, created_by)
         values ($1, 'sandbox', $2, $3)`,
        [orgId, customerReference, signedIn.user!.id],
      );
      const subscriptionReference = `sub_${randomUUID().slice(0, 12)}`;
      const at = 1_900_000_000;
      const send = (status: string, createdAt: number) =>
        applySubscriptionEvent(pg, {
          type: 'customer.subscription.updated',
          customerReference,
          subscriptionReference,
          status,
          createdAt,
          items: [{ priceReference: `price_${randomUUID().slice(0, 8)}` }],
        });

      await send('active', at);
      expect((await computeReadiness(ownerDb, { organizationId: orgId })).blockers.map((b) => b.key)).not.toContain(
        'subscription',
      );
      await launchOrganization(ownerDb, { organizationId: orgId });
      expect((await requireOrganizationForBillingRecovery(orgId)).organization.operationalState).toBe('live');
      await expect(requireOrganization(orgId)).resolves.toBeTruthy();

      // Live, and no longer in Setup's leniency: a lapse is a lock.
      await send('canceled', at + 10);
      await expect(requireOrganization(orgId)).rejects.toThrow(`REDIRECT:${serviceLockedHref(orgId)}`);
    } finally {
      await pg.end();
    }
  }, 60_000);
});
