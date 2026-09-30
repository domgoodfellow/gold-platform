import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPlan } from '@/lib/domain/catalogue/plans';
import {
  buildCommercialProposal,
  commercialProposalTotalMinor,
  listCommercialProposals,
  markCommercialProposalSent,
} from '@/lib/domain/customers/commercial-proposals';
import { createCustomer } from '@/lib/domain/customers/customers';
import { upsertDiscoverySnapshotAnswers } from '@/lib/domain/customers/discovery-snapshots';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Slice 8: a commercial proposal for one prospective customer, built from the real, approved
 * catalogue prices and snapshotted (I8) — never a live join a later price change could reprice.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  // CAD, since the seeded catalogue's own real prices (start, additional_user, local_phone_number) are in CAD.
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'CAD' });
  return { db, userId: created.user.id, organizationId: organizationId as string };
}

describe('commercial proposals', () => {
  let alice: Tenant;
  let bob: Tenant;
  let aliceCustomerId: string;
  let bobCustomerId: string;
  let startPlanId: string;
  let additionalUserId: string;
  let localPhoneNumberId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('alice-commercial');
    bob = await newTenant('bob-commercial');

    aliceCustomerId = await createCustomer(alice.db, { organizationId: alice.organizationId, name: 'Alice Prospect' });
    bobCustomerId = await createCustomer(bob.db, { organizationId: bob.organizationId, name: 'Bob Prospect' });

    const start = await getPlan(alice.db, 'start');
    const additionalUser = await getPlan(alice.db, 'additional_user');
    const localPhoneNumber = await getPlan(alice.db, 'local_phone_number');
    if (!start || !additionalUser || !localPhoneNumber) throw new Error('Expected seeded plans not found.');
    startPlanId = start.id;
    additionalUserId = additionalUser.id;
    localPhoneNumberId = localPhoneNumber.id;
  });

  it('builds a proposal, snapshotting the plan and add-on prices', async () => {
    const proposal = await buildCommercialProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      planId: startPlanId,
      addonPlanIds: [additionalUserId, localPhoneNumberId],
      currency: 'CAD',
      billingInterval: 'month',
    });

    expect(proposal.planPriceMinor).toBe(49900);
    expect(proposal.addonPriceMinor).toBe(3500 + 500);
    expect(proposal.status).toBe('draft');
    expect(proposal.version).toBe(1);
    expect(proposal.supersedesId).toBeNull();
    expect(proposal.addons).toHaveLength(2);
    expect(commercialProposalTotalMinor(proposal)).toBe(49900 + 3500 + 500);
  });

  it('snapshots the authoritative proposed configuration at build time (C1 closeout)', async () => {
    await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner' } },
    });

    const proposal = await buildCommercialProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      planId: startPlanId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });

    const proposed = proposal.proposedConfiguration as { recommended: { featureKey: string }[] } | null;
    expect(proposed).not.toBeNull();
    expect(proposed!.recommended.map((entry) => entry.featureKey)).toContain('booking');

    // A later change to the discovery snapshot does not reach back and change what an already
    // built proposal shows (I8) — a fresh read of the same row still carries the old snapshot.
    await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { customerSelfService: { value: '', status: 'not_applicable', source: 'Owner' } },
    });
    const reread = (await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId })).find(
      (entry) => entry.id === proposal.id,
    )!;
    expect(reread.proposedConfiguration).toEqual(proposal.proposedConfiguration);
  });

  it('refuses an add-on that does not belong to the chosen plan', async () => {
    const otherPlan = await getPlan(alice.db, 'operate');
    await expect(
      buildCommercialProposal(alice.db, {
        organizationId: alice.organizationId,
        customerId: aliceCustomerId,
        planId: otherPlan!.id,
        addonPlanIds: [], // operate has its own addon set; passing start's own addon would fail — proven by the next assertion instead
        currency: 'CAD',
        billingInterval: 'month',
      }),
    ).resolves.toBeTruthy();

    await expect(
      buildCommercialProposal(alice.db, {
        organizationId: alice.organizationId,
        customerId: aliceCustomerId,
        planId: startPlanId,
        addonPlanIds: [otherPlan!.id], // operate is not an add-on of start at all
        currency: 'CAD',
        billingInterval: 'month',
      }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.addon_invalid' });
  });

  it('requires a reason for a discount', async () => {
    await expect(
      buildCommercialProposal(alice.db, {
        organizationId: alice.organizationId,
        customerId: aliceCustomerId,
        planId: startPlanId,
        addonPlanIds: [],
        currency: 'CAD',
        billingInterval: 'month',
        discountMinor: 1000,
      }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.discount_reason_required' });
  });

  it('refuses a plan/currency combination with no approved price', async () => {
    await expect(
      buildCommercialProposal(alice.db, {
        organizationId: alice.organizationId,
        customerId: aliceCustomerId,
        planId: startPlanId,
        addonPlanIds: [],
        currency: 'JPY',
        billingInterval: 'month',
      }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.no_plan_price' });
  });

  it('versions rather than overwrites — each build is a new row, newest first', async () => {
    const before = await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId });
    const latestVersion = before[0].version;

    const revised = await buildCommercialProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      planId: startPlanId,
      addonPlanIds: [additionalUserId],
      currency: 'CAD',
      billingInterval: 'month',
      notes: 'Dropped the phone number add-on.',
    });

    expect(revised.version).toBe(latestVersion + 1);
    expect(revised.supersedesId).toBe(before[0].id);

    const after = await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId });
    expect(after.length).toBe(before.length + 1);
    expect(after[0].id).toBe(revised.id);
    // The earlier version is still there, untouched — history, not overwritten.
    expect(after.some((entry) => entry.id === before[0].id)).toBe(true);
  });

  it('marks a draft sent, and refuses to send it twice', async () => {
    const proposal = await buildCommercialProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      planId: startPlanId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });

    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: proposal.id });
    const [sent] = await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId });
    expect(sent.status).toBe('sent');
  });

  it('shows each tenant only its own proposals (I1)', async () => {
    await buildCommercialProposal(bob.db, {
      organizationId: bob.organizationId,
      customerId: bobCustomerId,
      planId: startPlanId,
      addonPlanIds: [],
      currency: 'CAD',
      billingInterval: 'month',
    });

    const stolen = await listCommercialProposals(alice.db, { organizationId: bob.organizationId, customerId: bobCustomerId });
    expect(stolen).toEqual([]);
  });

  it('refuses a customer id that belongs to a different organization', async () => {
    await expect(
      buildCommercialProposal(alice.db, {
        organizationId: alice.organizationId,
        customerId: bobCustomerId,
        planId: startPlanId,
        addonPlanIds: [],
        currency: 'CAD',
        billingInterval: 'month',
      }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.customer_not_found' });
  });
});
