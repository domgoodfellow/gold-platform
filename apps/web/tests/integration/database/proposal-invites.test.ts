import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPlan } from '@/lib/domain/catalogue/plans';
import {
  acceptCommercialProposal,
  buildCommercialProposal,
  declineCommercialProposal,
  listCommercialProposalsForExternalCustomer,
  markCommercialProposalSent,
} from '@/lib/domain/customers/commercial-proposals';
import { createCustomer } from '@/lib/domain/customers/customers';
import { getDiscoverySnapshot, upsertDiscoverySnapshotAnswers } from '@/lib/domain/customers/discovery-snapshots';
import {
  claimProposalInvite,
  createProposalInvite,
  revokeProposalInvite,
} from '@/lib/domain/customers/proposal-invites';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Slice 9: a prospect opens a secure link and reviews, then accepts or declines, their own
 * commercial proposal. Pays for nothing new on the external axis — this proves the third
 * kind of token over it behaves exactly like the portal's: a stranger sees rows about the
 * customer they were recognized as, and nothing about anyone else's.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Business = { db: SupabaseClient; organizationId: string };

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function newBusiness(label: string): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;

  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'CAD' });
  return { db, organizationId: organizationId as string };
}

describe('a prospect reviewing their own commercial proposal', () => {
  let shop: Business;
  let rival: Business;
  let customerId: string;
  let planId: string;
  let sentProposalId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    shop = await newBusiness('pi-shop');
    rival = await newBusiness('pi-rival');

    customerId = await createCustomer(shop.db, { organizationId: shop.organizationId, name: 'Prospect Co' });
    await upsertDiscoverySnapshotAnswers(shop.db, {
      organizationId: shop.organizationId,
      customerId,
      patch: { bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner' } },
    });

    const start = await getPlan(shop.db, 'start');
    planId = start!.id;

    // A draft, never sent — must stay invisible externally.
    await buildCommercialProposal(shop.db, {
      organizationId: shop.organizationId,
      customerId,
      planId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });
  });

  it('sees nothing while every proposal is still a draft', async () => {
    const token = await createProposalInvite(shop.db, { customerId });
    const db = anonClient();
    await claimProposalInvite(db, { token });

    const proposals = await listCommercialProposalsForExternalCustomer(db);
    expect(proposals).toEqual([]);
  });

  it('sees a sent proposal, and its discovery snapshot, once one exists', async () => {
    const built = await buildCommercialProposal(shop.db, {
      organizationId: shop.organizationId,
      customerId,
      planId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });
    await markCommercialProposalSent(shop.db, { organizationId: shop.organizationId, proposalId: built.id });
    sentProposalId = built.id;

    const token = await createProposalInvite(shop.db, { customerId });
    const db = anonClient();
    await claimProposalInvite(db, { token });

    const proposals = await listCommercialProposalsForExternalCustomer(db);
    expect(proposals.map((p) => p.id)).toContain(sentProposalId);
    expect(proposals.every((p) => p.status !== 'draft')).toBe(true);

    const snapshot = await getDiscoverySnapshot(db, { organizationId: shop.organizationId, customerId });
    expect(snapshot?.answers.bookingIntake?.value).toBe('Books online.');
  });

  it('accepts a sent proposal, recording who and when', async () => {
    const token = await createProposalInvite(shop.db, { customerId });
    const db = anonClient();
    await claimProposalInvite(db, { token });

    await acceptCommercialProposal(db, { proposalId: sentProposalId });

    const proposals = await listCommercialProposalsForExternalCustomer(db);
    const accepted = proposals.find((p) => p.id === sentProposalId)!;
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedAt).not.toBeNull();
    expect(accepted.acceptedBy).not.toBeNull();
    // Copied from the proposal's own snapshot, not from anything the caller supplied (C1 closeout).
    expect(accepted.acceptedConfiguration).toEqual(accepted.proposedConfiguration);
  });

  it('refuses to accept a proposal that is not open for a response', async () => {
    const token = await createProposalInvite(shop.db, { customerId });
    const db = anonClient();
    await claimProposalInvite(db, { token });

    // Already accepted by the previous test.
    await expect(
      acceptCommercialProposal(db, { proposalId: sentProposalId }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.accept_forbidden' });
  });

  it('declines a sent proposal, recording who and when', async () => {
    const built = await buildCommercialProposal(shop.db, {
      organizationId: shop.organizationId,
      customerId,
      planId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });
    await markCommercialProposalSent(shop.db, { organizationId: shop.organizationId, proposalId: built.id });

    const token = await createProposalInvite(shop.db, { customerId });
    const db = anonClient();
    await claimProposalInvite(db, { token });

    await declineCommercialProposal(db, { proposalId: built.id });

    const proposals = await listCommercialProposalsForExternalCustomer(db);
    const declined = proposals.find((p) => p.id === built.id)!;
    expect(declined.status).toBe('declined');
    expect(declined.declinedAt).not.toBeNull();
    expect(declined.declinedBy).not.toBeNull();
  });

  it('refuses a revoked link', async () => {
    const token = await createProposalInvite(shop.db, { customerId });
    const invites = await shop.db
      .from('customer_proposal_invites')
      .select('id')
      .eq('organization_id', shop.organizationId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1);
    await revokeProposalInvite(shop.db, { id: invites.data![0].id });

    const db = anonClient();
    await expect(claimProposalInvite(db, { token })).rejects.toMatchObject({ code: 'proposal_invites.invalid_link' });
  });

  it("never lets a rival business's prospect see this one's proposal", async () => {
    const rivalCustomerId = await createCustomer(rival.db, { organizationId: rival.organizationId, name: 'Rival Prospect' });
    const token = await createProposalInvite(rival.db, { customerId: rivalCustomerId });
    const db = anonClient();
    await claimProposalInvite(db, { token });

    const proposals = await listCommercialProposalsForExternalCustomer(db);
    expect(proposals.map((p) => p.id)).not.toContain(sentProposalId);
  });
});
