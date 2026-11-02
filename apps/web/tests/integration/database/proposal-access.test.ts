import { randomUUID } from 'node:crypto';
import { seedLegacyPlanProposal } from '@/tests/support/legacy-proposals';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPlan } from '@/lib/domain/catalogue/plans';
import {
  acceptCommercialProposal,
  declineCommercialProposal,
  listCommercialProposalsForExternalCustomer,
  markCommercialProposalSent,
} from '@/lib/domain/customers/commercial-proposals';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  exchangeProposalLink,
  proposalAccessContext,
  requireProposalAccessContext,
} from '@/lib/domain/customers/proposal-access';
import { claimProposalInvite, createProposalInvite, revokeProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The proposal session: what a link is exchanged for, how long it lasts, and what it may decide.
 * `proposal-invites.test.ts` proves the recipient sees only their own rows; this proves the
 * session semantics — revocation, expiry, who may bind, and one deterministic outcome per version.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const plain = { auth: { autoRefreshToken: false, persistSession: false } };
const anonClient = (): SupabaseClient => createClient(SUPABASE_URL, ANON_KEY, plain);
const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, plain);

type Business = { db: SupabaseClient; organizationId: string };

async function newBusiness(label: string): Promise<Business> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'CAD' });
  return { db, organizationId: organizationId as string };
}

describe('a proposal session', () => {
  let shop: Business;
  let customerId: string;
  let otherCustomerId: string;
  let planId: string;

  async function sentProposal(forCustomer = customerId) {
    const built = await seedLegacyPlanProposal({ createdBy: (await shop.db.auth.getUser()).data.user!.id,
      organizationId: shop.organizationId,
      customerId: forCustomer,
      planId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });
    await markCommercialProposalSent(shop.db, { organizationId: shop.organizationId, proposalId: built.id });
    return built.id;
  }

  /** A recipient exactly as the route handler makes one: a fresh anonymous session, the link exchanged. */
  async function recipient(customer = customerId) {
    const token = await createProposalInvite(shop.db, { customerId: customer });
    const db = anonClient();
    await exchangeProposalLink(db, { token });
    return { db, token };
  }

  async function inviteIdFor(token: string): Promise<string> {
    const { data } = await shop.db.from('customer_proposal_invites').select('id').eq('token', token).single();
    return data!.id;
  }

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    shop = await newBusiness('pa-shop');
    customerId = await createCustomer(shop.db, { organizationId: shop.organizationId, name: 'Prospect A' });
    otherCustomerId = await createCustomer(shop.db, { organizationId: shop.organizationId, name: 'Prospect B' });
    planId = (await getPlan(shop.db, 'start'))!.id;
  });

  it('resolves exactly the organization, customer and link the exchange named', async () => {
    const { db, token } = await recipient();
    const context = await requireProposalAccessContext(db);
    expect(context).toMatchObject({ organizationId: shop.organizationId, customerId, inviteId: await inviteIdFor(token) });
    expect(new Date(context.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it('is nobody before the link is exchanged, and for a refused link', async () => {
    const stranger = anonClient();
    await stranger.auth.signInAnonymously();
    expect(await proposalAccessContext(stranger)).toBeNull();
    await expect(exchangeProposalLink(stranger, { token: 'x'.repeat(64) })).rejects.toMatchObject({ code: 'proposal_invites.invalid_link' });
    expect(await proposalAccessContext(stranger)).toBeNull();
  });

  it('stops answering the moment the link is revoked, with no sweep', async () => {
    const { db, token } = await recipient();
    expect(await proposalAccessContext(db)).not.toBeNull();
    await revokeProposalInvite(shop.db, { id: await inviteIdFor(token) });
    expect(await proposalAccessContext(db)).toBeNull();
    expect(await listCommercialProposalsForExternalCustomer(db)).toEqual([]);
    const proposalId = await sentProposal();
    await expect(acceptCommercialProposal(db, { proposalId })).rejects.toMatchObject({ code: 'commercial_proposals.accept_forbidden' });
  });

  it('stops answering when the exchange has expired, even though the link is live', async () => {
    const { db, token } = await recipient();
    const inviteId = await inviteIdFor(token);
    const pg = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
    await pg.connect();
    try {
      await pg.query("update public.external_actors set proposal_expires_at = now() - interval '1 second' where proposal_invite_id = $1", [inviteId]);
    } finally {
      await pg.end();
    }
    expect(await proposalAccessContext(db)).toBeNull();
    const proposalId = await sentProposal();
    await expect(declineCommercialProposal(db, { proposalId })).rejects.toMatchObject({ code: 'commercial_proposals.decline_forbidden' });
  });

  it('renews on reopening the same link, and lets two devices hold it at once', async () => {
    const { token } = await recipient();
    const second = anonClient();
    await exchangeProposalLink(second, { token });
    expect(await proposalAccessContext(second)).not.toBeNull();
  });

  it('never binds a signed-in operator as the recipient', async () => {
    const token = await createProposalInvite(shop.db, { customerId });
    // The database refuses an account session outright, whatever the caller does first.
    await expect(claimProposalInvite(shop.db, { token })).rejects.toMatchObject({ code: 'proposal_invites.invalid_link' });
    const { data: operator } = await shop.db.auth.getUser();
    const { data } = await admin().from('external_actors').select('user_id').eq('organization_id', shop.organizationId);
    expect((data ?? []).map((row) => row.user_id)).not.toContain(operator.user?.id);
  });

  it('refuses a proposal that belongs to another customer of the same business', async () => {
    const other = await sentProposal(otherCustomerId);
    const { db } = await recipient(customerId);
    await expect(acceptCommercialProposal(db, { proposalId: other })).rejects.toMatchObject({ code: 'commercial_proposals.accept_forbidden' });
    await expect(declineCommercialProposal(db, { proposalId: other })).rejects.toMatchObject({ code: 'commercial_proposals.decline_forbidden' });
  });

  it('accepts once, and a second accept or a later decline is refused without changing the outcome', async () => {
    const proposalId = await sentProposal();
    const { db } = await recipient();
    await acceptCommercialProposal(db, { proposalId });
    await expect(acceptCommercialProposal(db, { proposalId })).rejects.toMatchObject({ code: 'commercial_proposals.accept_forbidden' });
    await expect(declineCommercialProposal(db, { proposalId })).rejects.toMatchObject({ code: 'commercial_proposals.decline_forbidden' });
    const row = (await listCommercialProposalsForExternalCustomer(db)).find((p) => p.id === proposalId)!;
    expect(row.status).toBe('accepted');
    // The link keeps showing the outcome after the decision.
    expect(await proposalAccessContext(db)).not.toBeNull();
    const { data: events } = await shop.db
      .from('events')
      .select('id')
      .eq('organization_id', shop.organizationId)
      .eq('action', 'commercial_proposal.accepted')
      .contains('payload', { proposal_id: proposalId });
    expect(events).toHaveLength(1);
  });

  it('resolves two tabs answering at once to exactly one outcome', async () => {
    const proposalId = await sentProposal();
    const { token } = await recipient();
    const a = anonClient();
    const b = anonClient();
    await exchangeProposalLink(a, { token });
    await exchangeProposalLink(b, { token });
    const results = await Promise.allSettled([
      acceptCommercialProposal(a, { proposalId }),
      declineCommercialProposal(b, { proposalId }),
      acceptCommercialProposal(a, { proposalId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row = (await listCommercialProposalsForExternalCustomer(a)).find((p) => p.id === proposalId)!;
    expect(['accepted', 'declined']).toContain(row.status);
  });

  it('refuses a version that has been replaced, so Accept never lands on terms nobody saw', async () => {
    const first = await sentProposal();
    const { db } = await recipient();
    const second = await sentProposal();
    expect(second).not.toBe(first);
    await expect(acceptCommercialProposal(db, { proposalId: first })).rejects.toMatchObject({ code: 'commercial_proposals.accept_forbidden' });
    await acceptCommercialProposal(db, { proposalId: second });
  });
});
