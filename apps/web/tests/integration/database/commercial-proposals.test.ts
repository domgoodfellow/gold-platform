import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlan } from '@/lib/domain/catalogue/plans';
import {
  buildCatalogProposal,
  commercialProposalTotalMinor,
  listCommercialProposals,
  markCommercialProposalSent,
} from '@/lib/domain/customers/commercial-proposals';
import { recommendConfiguration } from '@/lib/domain/customers/configuration-recommendation';
import { createCustomer } from '@/lib/domain/customers/customers';
import { upsertDiscoverySnapshotAnswers } from '@/lib/domain/customers/discovery-snapshots';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { foundBusiness } from '@/tests/support/founding';
import { seedLegacyPlanProposal } from '@/tests/support/legacy-proposals';

/**
 * Slice 8: a commercial proposal for one prospective customer, priced from real prices and
 * snapshotted — never a live join a later price change could reprice.
 *
 * Since ADR-051's catalog slice a new version is built from the business's own catalog
 * (`build_catalog_proposal`; its full contract is `catalog-proposals.test.ts`). Platform Plan
 * proposals built before then are history: no signed-in caller can write one, and each still reads
 * with the plan and add-on prices it was built with.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; itemId: string };

let pg: Client;

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
  const organizationId = (await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'CAD' })) as string;
  await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'billing',$2) on conflict do nothing`, [organizationId, created.user.id]);
  await pg.query(
    `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
     select $1,'module:billing','2020-01-01','9999-12-31',1,0,'CAD',$2,'commercial proposal test'
      where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:billing')`,
    [organizationId, created.user.id],
  );
  const itemId = await createPriceBookItem(db, { organizationId, name: 'Consultation', unit: 'hour', unitAmountMinor: 9_000 });
  return { db, userId: created.user.id, organizationId, itemId };
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
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
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

  afterAll(async () => {
    await pg?.end();
  });

  it('still reads a Platform Plan proposal with the plan and add-on prices it was built with', async () => {
    const seeded = await seedLegacyPlanProposal({
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      createdBy: alice.userId,
      planId: startPlanId,
      addonPlanIds: [additionalUserId, localPhoneNumberId],
      currency: 'CAD',
      billingInterval: 'month',
    });
    const proposal = (await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId })).find((entry) => entry.id === seeded.id)!;

    expect(proposal.basis).toBe('platform_plan');
    expect(proposal.planPriceMinor).toBe(49900);
    expect(proposal.addonPriceMinor).toBe(3500 + 500);
    expect(proposal.status).toBe('draft');
    expect(proposal.version).toBe(1);
    expect(proposal.supersedesId).toBeNull();
    expect(proposal.addons).toHaveLength(2);
    expect(commercialProposalTotalMinor(proposal)).toBe(49900 + 3500 + 500);
  });

  it('keeps a Platform Plan proposal\'s proposed configuration as it was built (C1 closeout)', async () => {
    const patch = { bookingIntake: { value: 'Books online.', status: 'confirmed', source: 'Owner' } } as const;
    await upsertDiscoverySnapshotAnswers(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId, patch });
    const configuration = await recommendConfiguration(alice.db, { answers: { bookingIntake: { ...patch.bookingIntake, updatedAt: new Date().toISOString() } } });
    const seeded = await seedLegacyPlanProposal({
      organizationId: alice.organizationId, customerId: aliceCustomerId, createdBy: alice.userId,
      planId: startPlanId, currency: 'CAD', billingInterval: 'month', proposedConfiguration: configuration,
    });

    // A later change to the discovery snapshot does not reach back and change what an already
    // built proposal shows — a fresh read of the same row still carries the old snapshot.
    await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { customerSelfService: { value: '', status: 'not_applicable', source: 'Owner' } },
    });
    const reread = (await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId })).find(
      (entry) => entry.id === seeded.id,
    )!;
    const proposed = reread.proposedConfiguration as { recommended: { featureKey: string }[] } | null;
    expect(proposed!.recommended.map((entry) => entry.featureKey)).toContain('booking');
    expect(reread.proposedConfiguration).toEqual(JSON.parse(JSON.stringify(configuration)));
  });

  it('no longer lets a signed-in member write a Platform Plan proposal, at any price', async () => {
    const { error } = await alice.db.from('customer_commercial_proposals').insert({
      organization_id: alice.organizationId, customer_id: aliceCustomerId, plan_id: startPlanId, plan_label: 'Start',
      currency: 'CAD', billing_interval: 'month', plan_price_minor: 1, version: 500, created_by: alice.userId,
    });
    expect(error?.code).toBe('42501');

    // Nor through the catalog builder: a Platform Plan is not one of this business's catalog items.
    await expect(
      buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId, lines: [{ priceBookItemId: startPlanId, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.item_not_found' });
  });

  it('versions rather than overwrites — each build is a new row, newest first', async () => {
    const before = await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId });
    const latestVersion = before[0].version;

    const revised = await buildCatalogProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      lines: [{ priceBookItemId: alice.itemId, quantity: 2 }],
      notes: 'Moved to our own services.',
    });

    expect(revised.version).toBe(latestVersion + 1);
    expect(revised.supersedesId).toBe(before[0].id);

    const after = await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId });
    expect(after.length).toBe(before.length + 1);
    expect(after[0].id).toBe(revised.id);
    // The earlier version is still there, untouched — history, not overwritten.
    expect(after.find((entry) => entry.id === before[0].id)).toEqual(before[0]);
  });

  it('marks a draft sent, and refuses to send it twice', async () => {
    const proposal = await buildCatalogProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      lines: [{ priceBookItemId: alice.itemId, quantity: 1 }],
    });

    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: proposal.id });
    const [sent] = await listCommercialProposals(alice.db, { organizationId: alice.organizationId, customerId: aliceCustomerId });
    expect(sent.status).toBe('sent');
  });

  it('shows each tenant only its own proposals', async () => {
    await buildCatalogProposal(bob.db, {
      organizationId: bob.organizationId,
      customerId: bobCustomerId,
      lines: [{ priceBookItemId: bob.itemId, quantity: 1 }],
    });

    const stolen = await listCommercialProposals(alice.db, { organizationId: bob.organizationId, customerId: bobCustomerId });
    expect(stolen).toEqual([]);
    const { data: lines } = await alice.db.from('customer_commercial_proposal_lines').select('id').eq('organization_id', bob.organizationId);
    expect(lines).toEqual([]);
  });

  it('refuses a customer id that belongs to a different organization', async () => {
    await expect(
      buildCatalogProposal(alice.db, {
        organizationId: alice.organizationId,
        customerId: bobCustomerId,
        lines: [{ priceBookItemId: alice.itemId, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'commercial_proposals.customer_not_found' });
  });
});
