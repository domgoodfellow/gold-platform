import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPlan } from '@/lib/domain/catalogue/plans';
import { acceptCommercialProposal, buildCommercialProposal, markCommercialProposalSent } from '@/lib/domain/customers/commercial-proposals';
import { createCustomer, getCustomer } from '@/lib/domain/customers/customers';
import { upsertDiscoverySnapshotAnswers } from '@/lib/domain/customers/discovery-snapshots';
import { claimProposalInvite, createProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { getProposalHandoff, handoffAcceptedProposal } from '@/lib/domain/customers/proposal-handoff';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Slice 10: "Create this business in GildOps," from an accepted proposal. Proves the terminal
 * boundary this repo's own D29 already drew: only platform staff may provision, the original
 * GildOps customer record is untouched, and a second handoff attempt is refused rather than
 * creating a second business for one acceptance.
 *
 * The reads this function makes (the proposal, the customer, the discovery snapshot) need
 * ordinary GildOps organization membership; the provisioning write needs genuine platform staff
 * authority. One person plausibly holds both (D45: "one identity, capable of holding platform
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
    const ownerEmail = `owner-${randomUUID().slice(0, 8)}@example.test`;
    const { error: ownerCreateError } = await admin.auth.admin.createUser({ email: ownerEmail, password: `pw-${randomUUID()}`, email_confirm: true });
    if (ownerCreateError) throw ownerCreateError;

    customerId = await createCustomer(repDb, { organizationId: gildOpsOrgId, name: 'Handoff Prospect Co', email: ownerEmail });
    await upsertDiscoverySnapshotAnswers(repDb, {
      organizationId: gildOpsOrgId,
      customerId,
      patch: { bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner' } },
    });

    const start = await getPlan(repDb, 'start');
    const built = await buildCommercialProposal(repDb, {
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

  it('creates the business, records the handoff, and leaves the GildOps customer untouched', async () => {
    // Promote the same, already-signed-in rep to platform staff — live-checked (D45), so no
    // re-sign-in is needed for it to take effect on this session's next request.
    const pg = new Client(CONNECTION);
    await pg.connect();
    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [repUserId, 'Rep (test staff)']);
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

  it('refuses to hand off a proposal that was never accepted', async () => {
    const start = await getPlan(repDb, 'start');
    const draft = await buildCommercialProposal(repDb, {
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
});
