import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptCommercialProposal,
  buildCatalogProposal,
  commercialProposalTotalMinor,
  declineCommercialProposal,
  getCommercialProposal,
  listCommercialProposals,
  listCommercialProposalsForExternalCustomer,
  markCommercialProposalSent,
} from '@/lib/domain/customers/commercial-proposals';
import { createCustomer } from '@/lib/domain/customers/customers';
import { claimProposalInvite, createProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { getPlan } from '@/lib/domain/catalogue/plans';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';
import { seedLegacyPlanProposal } from '@/tests/support/legacy-proposals';

/**
 * Commercial proposals built from a business's own catalog (ADR-051, second slice).
 *
 * What is held here: the price on a proposal is the catalog's at the moment it was built and never
 * the caller's; a version is written whole or not at all, and concurrent builds take consecutive
 * versions; an accepted version keeps its terms through a later catalog change; acceptance issues
 * no invoice and grants nothing; and a catalog proposal can never reach the GildOps technical
 * hand-off, whoever asks — while a Platform Plan proposal made before this slice still reads.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; itemId: string; customerId: string };

let pg: Client;
let alice: Tenant;
let bob: Tenant;

const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function signIn(label: string): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anon();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id, email };
}

/** An ordinary business — not GildOps — with Billing usable, one catalog item and one customer. */
async function newTenant(label: string): Promise<Tenant> {
  const { db, userId, email } = await signIn(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Founder', timezone: 'America/Toronto', currency: 'CAD' });
  await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'billing',$2) on conflict do nothing`, [organizationId, userId]);
  await pg.query(
    `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
     select $1,'module:billing','2020-01-01','9999-12-31',1,0,'CAD',$2,'catalog proposal test'
      where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:billing')`,
    [organizationId, userId],
  );
  const itemId = await createPriceBookItem(db, { organizationId, name: 'Garden design', unit: 'hour', unitAmountMinor: 12_000 });
  const customerId = await createCustomer(db, { organizationId, name: `${label} Prospect` });
  return { db, userId, organizationId, itemId, customerId };
}

const rpc = (tenant: Pick<Tenant, 'db' | 'organizationId' | 'customerId'>, lines: unknown, notes = '') =>
  tenant.db.rpc('build_catalog_proposal', {
    p_organization_id: tenant.organizationId,
    p_customer_id: tenant.customerId,
    p_lines: lines as never,
    p_notes: notes,
  });

async function proposalCount(organizationId: string, customerId: string): Promise<number> {
  const { rows } = await pg.query(`select count(*)::int as n from public.customer_commercial_proposals where organization_id = $1 and customer_id = $2`, [organizationId, customerId]);
  return rows[0].n;
}

/** Send a proposal and open it as its recipient, the way the emailed link does. */
async function recipientOf(tenant: Tenant, proposalId: string, customerId = tenant.customerId): Promise<SupabaseClient> {
  await markCommercialProposalSent(tenant.db, { organizationId: tenant.organizationId, proposalId });
  const token = await createProposalInvite(tenant.db, { customerId });
  const visitor = anon();
  await claimProposalInvite(visitor, { token });
  return visitor;
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  alice = await newTenant('catprop-alice');
  bob = await newTenant('catprop-bob');
});

afterAll(async () => {
  await pg?.end();
});

describe('building a catalog proposal', () => {
  it('copies each line from the catalog and totals the copies', async () => {
    const second = await createPriceBookItem(alice.db, { organizationId: alice.organizationId, name: 'Site visit', unit: 'visit', unitAmountMinor: 7_500 });
    const proposal = await buildCatalogProposal(alice.db, {
      organizationId: alice.organizationId,
      customerId: alice.customerId,
      lines: [{ priceBookItemId: alice.itemId, quantity: 3 }, { priceBookItemId: second, quantity: 1 }],
      notes: '  Spring planting.  ',
    });

    expect(proposal).toMatchObject({
      basis: 'catalog', status: 'draft', planId: null, planLabel: null, currency: 'CAD', billingInterval: 'one_time',
      planPriceMinor: 0, addonPriceMinor: 0, discountMinor: 0, catalogTotalMinor: 3 * 12_000 + 7_500, notes: 'Spring planting.',
      proposedConfiguration: null, addons: [],
    });
    expect(proposal.lines).toEqual([
      { position: 1, priceBookItemId: alice.itemId, name: 'Garden design', unit: 'hour', currency: 'CAD', quantity: 3, unitAmountMinor: 12_000, amountMinor: 36_000 },
      { position: 2, priceBookItemId: second, name: 'Site visit', unit: 'visit', currency: 'CAD', quantity: 1, unitAmountMinor: 7_500, amountMinor: 7_500 },
    ]);
    expect(commercialProposalTotalMinor(proposal)).toBe(43_500);

    const { rows } = await pg.query(`select action, entity_type, payload from public.events where organization_id = $1 and payload ->> 'proposal_id' = $2`, [alice.organizationId, proposal.id]);
    expect(rows).toEqual([expect.objectContaining({ action: 'commercial_proposal.built', entity_type: 'customer' })]);
  });

  it('refuses every attempt to name a price, a total or anything but an item and a whole quantity', async () => {
    const before = await proposalCount(alice.organizationId, alice.customerId);
    const spoofs: unknown[] = [
      [{ price_book_item_id: alice.itemId, quantity: 1, unit_amount_minor: 1 }],
      [{ price_book_item_id: alice.itemId, quantity: 1, amount_minor: 1 }],
      [{ price_book_item_id: alice.itemId, quantity: 1, price: 1 }],
      [{ price_book_item_id: alice.itemId, quantity: 1, discount_minor: 5_000 }],
      [{ price_book_item_id: alice.itemId, quantity: 1, name: 'Free' }],
      [{ price_book_item_id: alice.itemId, quantity: 1.5 }],
      [{ price_book_item_id: alice.itemId, quantity: 0 }],
      [{ price_book_item_id: alice.itemId, quantity: -2 }],
      [{ price_book_item_id: alice.itemId, quantity: '2' }],
      [{ price_book_item_id: alice.itemId, quantity: 1_000_001 }],
      [{ quantity: 1 }],
      [{ price_book_item_id: 'not-a-uuid', quantity: 1 }],
      [],
      { price_book_item_id: alice.itemId, quantity: 1 },
      Array.from({ length: 101 }, () => ({ price_book_item_id: alice.itemId, quantity: 1 })),
    ];
    for (const lines of spoofs) {
      const { error } = await rpc(alice, lines);
      expect(error?.code, JSON.stringify(lines).slice(0, 80)).toBe('22023');
    }
    expect((await rpc(alice, [{ price_book_item_id: alice.itemId, quantity: 1 }], 'x'.repeat(4_001))).error?.code).toBe('22023');
    expect(await proposalCount(alice.organizationId, alice.customerId)).toBe(before);
  });

  it('refuses another business\'s customer or catalog item, and writes nothing when one line is wrong', async () => {
    const before = await proposalCount(alice.organizationId, alice.customerId);
    expect((await rpc({ ...alice, customerId: bob.customerId }, [{ price_book_item_id: alice.itemId, quantity: 1 }])).error?.code).toBe('GD011');
    const mixed = await rpc(alice, [{ price_book_item_id: alice.itemId, quantity: 1 }, { price_book_item_id: bob.itemId, quantity: 1 }]);
    expect(mixed.error?.code).toBe('GD012');
    expect(await proposalCount(alice.organizationId, alice.customerId)).toBe(before);
    expect(await proposalCount(bob.organizationId, alice.customerId)).toBe(0);
  });

  it('refuses an item priced outside the business\'s trading currency', async () => {
    const usd = await createPriceBookItem(alice.db, { organizationId: alice.organizationId, name: 'Imported plant', unit: 'each', unitAmountMinor: 900 });
    await pg.query(`update public.price_book_items set currency = 'USD' where id = $1`, [usd]);
    expect((await rpc(alice, [{ price_book_item_id: usd, quantity: 1 }])).error?.code).toBe('GD013');
  });

  it('requires membership and price.manage, and a usable catalog', async () => {
    const lines = [{ price_book_item_id: alice.itemId, quantity: 1 }];
    // Bob is signed in and holds price.manage — in his own business, not Alice's.
    expect((await rpc({ db: bob.db, organizationId: alice.organizationId, customerId: alice.customerId }, lines)).error?.code).toBe('42501');

    const clerk = await signIn('catprop-clerk');
    const roleId = await createRole(alice.db, { organizationId: alice.organizationId, name: `No pricing ${randomUUID().slice(0, 4)}`, capabilities: CAPABILITIES.filter((c) => c !== 'price.manage') });
    await pg.query(`insert into public.memberships(organization_id,user_id,role_id,created_by,display_name) values($1,$2,$3,$4,'Clerk')`, [alice.organizationId, clerk.userId, roleId, alice.userId]);
    const member = (await listMembers(alice.db, { organizationId: alice.organizationId })).find((m) => m.userId === clerk.userId)!;
    await assignRole(alice.db, { membershipId: member.id, roleId });
    expect((await rpc({ db: clerk.db, organizationId: alice.organizationId, customerId: alice.customerId }, lines)).error?.code).toBe('42501');

    expect((await rpc({ db: anon(), organizationId: alice.organizationId, customerId: alice.customerId }, lines)).error).not.toBeNull();

    const solo = await newTenant('catprop-nobilling');
    await pg.query(`delete from public.organization_modules where organization_id = $1 and module_key = 'billing'`, [solo.organizationId]);
    expect((await rpc(solo, [{ price_book_item_id: solo.itemId, quantity: 1 }])).error?.code).toBe('42501');
  });

  it('gives concurrent builds consecutive versions, each complete with its own lines', async () => {
    const tenant = await newTenant('catprop-race');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => rpc(tenant, [{ price_book_item_id: tenant.itemId, quantity: index + 1 }])),
    );
    expect(results.map((result) => result.error)).toEqual(Array(8).fill(null));

    const proposals = await listCommercialProposals(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId });
    expect(proposals.map((proposal) => proposal.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const proposal of proposals) {
      expect(proposal.lines).toHaveLength(1);
      expect(proposal.catalogTotalMinor).toBe(proposal.lines[0].amountMinor);
      const previous = proposals.find((entry) => entry.version === proposal.version - 1);
      expect(proposal.supersedesId).toBe(previous?.id ?? null);
    }
    const { rows } = await pg.query(
      `select count(*)::int as n from public.customer_commercial_proposal_lines l
        where l.organization_id = $1
          and not exists (select 1 from public.customer_commercial_proposals p where p.organization_id = l.organization_id and p.id = l.proposal_id)`,
      [tenant.organizationId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('what a client may write', () => {
  it('cannot insert a proposal, a line or an add-on directly, at any price', async () => {
    const plan = await getPlan(alice.db, 'start');
    const proposal = await alice.db.from('customer_commercial_proposals').insert({
      organization_id: alice.organizationId, customer_id: alice.customerId, basis: 'platform_plan', plan_id: plan!.id, plan_label: 'Start',
      currency: 'CAD', billing_interval: 'month', plan_price_minor: 1, version: 999, created_by: alice.userId,
    });
    expect(proposal.error?.code).toBe('42501');

    const built = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    const line = await alice.db.from('customer_commercial_proposal_lines').insert({
      organization_id: alice.organizationId, proposal_id: built.id, position: 2, price_book_item_id: alice.itemId,
      name: 'Free', unit: 'each', currency: 'CAD', quantity: 1, unit_amount_minor: 0, amount_minor: 0,
    });
    expect(line.error?.code).toBe('42501');

    const addon = await alice.db.from('customer_commercial_proposal_addons').insert({
      organization_id: alice.organizationId, proposal_id: built.id, addon_plan_id: plan!.id, label: 'x', price_minor: 0,
    });
    expect(addon.error?.code).toBe('42501');
  });

  it('cannot change a built proposal\'s price, lines or notes', async () => {
    const built = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 2 }] });
    expect((await alice.db.from('customer_commercial_proposals').update({ catalog_total_minor: 1 }).eq('id', built.id)).error?.code).toBe('42501');
    expect((await alice.db.from('customer_commercial_proposals').update({ notes: 'changed' }).eq('id', built.id)).error?.code).toBe('42501');
    expect((await alice.db.from('customer_commercial_proposal_lines').update({ unit_amount_minor: 1 }).eq('proposal_id', built.id)).error?.code).toBe('42501');
    expect((await alice.db.from('customer_commercial_proposal_lines').delete().eq('proposal_id', built.id)).error?.code).toBe('42501');
    expect((await alice.db.from('customer_commercial_proposals').delete().eq('id', built.id)).error?.code).toBe('42501');
    expect(await getCommercialProposal(alice.db, { organizationId: alice.organizationId, proposalId: built.id })).toEqual(built);
  });

  it('holds a catalog row to its own shape even for the database owner', async () => {
    const plan = await getPlan(alice.db, 'start');
    await expect(pg.query(
      `insert into public.customer_commercial_proposals (organization_id, customer_id, basis, plan_id, currency, billing_interval, plan_price_minor, catalog_total_minor, version, created_by)
       values ($1, $2, 'catalog', $3, 'CAD', 'one_time', 0, 0, 9001, $4)`,
      [alice.organizationId, alice.customerId, plan!.id, alice.userId],
    )).rejects.toThrow(/customer_commercial_proposals_basis_shape/);
    await expect(pg.query(
      `insert into public.customer_commercial_proposals (organization_id, customer_id, basis, currency, billing_interval, plan_price_minor, catalog_total_minor, version, created_by)
       values ($1, $2, 'catalog', 'CAD', 'month', 0, 0, 9002, $3)`,
      [alice.organizationId, alice.customerId, alice.userId],
    )).rejects.toThrow(/customer_commercial_proposals_basis_shape/);
  });
});

describe('the customer\'s answer', () => {
  it('keeps the accepted price and quantity through a later catalog change, and issues nothing', async () => {
    const tenant = await newTenant('catprop-history');
    const built = await buildCatalogProposal(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 4 }] });
    expect(built.lines[0].unitAmountMinor).toBe(12_000);

    const visitor = await recipientOf(tenant, built.id);
    await updatePriceBookItem(tenant.db, { id: tenant.itemId, name: 'Garden design (2027)', unit: 'hour', unitAmountMinor: 15_000 });

    // The recipient reads what was sent, not today's catalog.
    const [seen] = await listCommercialProposalsForExternalCustomer(visitor);
    expect(seen.lines[0]).toMatchObject({ name: 'Garden design', quantity: 4, unitAmountMinor: 12_000, amountMinor: 48_000 });

    await acceptCommercialProposal(visitor, { proposalId: built.id });

    const accepted = await getCommercialProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: built.id });
    expect(accepted).toMatchObject({ status: 'accepted', catalogTotalMinor: 48_000, acceptedConfiguration: null });
    expect(accepted!.lines).toEqual(built.lines);
    expect(accepted!.acceptedAt).not.toBeNull();

    // Acceptance is agreement only: no invoice, no hand-off, no Plan, agreement or new business.
    const counts = await pg.query(
      `select
         (select count(*) from public.invoices where organization_id = $1)::int as invoices,
         (select count(*) from public.customer_proposal_handoffs where organization_id = $1)::int as handoffs,
         (select count(*) from public.organization_plan_assignments a join public.customer_proposal_handoffs h on h.created_organization_id = a.organization_id where h.proposal_id = $2)::int as assignments`,
      [tenant.organizationId, built.id],
    );
    expect(counts.rows[0]).toEqual({ invoices: 0, handoffs: 0, assignments: 0 });

    // And the accepted terms cannot be reopened or edited by the seller afterwards.
    await tenant.db.from('customer_commercial_proposals').update({ status: 'draft' }).eq('id', built.id);
    await tenant.db.from('customer_commercial_proposals').update({ status: 'sent' }).eq('id', built.id);
    expect((await getCommercialProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: built.id }))!.status).toBe('accepted');

    // Nor answered twice.
    await expect(declineCommercialProposal(visitor, { proposalId: built.id })).rejects.toMatchObject({ code: 'commercial_proposals.decline_forbidden' });
  });

  it('lets the recipient decline, and shows one customer none of another\'s lines', async () => {
    const tenant = await newTenant('catprop-decline');
    const other = await createCustomer(tenant.db, { organizationId: tenant.organizationId, name: 'Someone else' });
    const theirs = await buildCatalogProposal(tenant.db, { organizationId: tenant.organizationId, customerId: other, lines: [{ priceBookItemId: tenant.itemId, quantity: 9 }] });
    await markCommercialProposalSent(tenant.db, { organizationId: tenant.organizationId, proposalId: theirs.id });

    const built = await buildCatalogProposal(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 1 }] });
    const visitor = await recipientOf(tenant, built.id);

    const { data: lines } = await visitor.from('customer_commercial_proposal_lines').select('proposal_id');
    expect(new Set((lines ?? []).map((line) => line.proposal_id))).toEqual(new Set([built.id]));
    await expect(acceptCommercialProposal(visitor, { proposalId: theirs.id })).rejects.toMatchObject({ code: 'commercial_proposals.accept_forbidden' });

    await declineCommercialProposal(visitor, { proposalId: built.id });
    const declined = await getCommercialProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: built.id });
    expect(declined).toMatchObject({ status: 'declined', acceptedAt: null });
    expect(declined!.declinedAt).not.toBeNull();
  });
});

describe('the GildOps technical hand-off', () => {
  it('refuses an accepted catalog proposal even to platform staff holding customer authority, and provisions nothing', async () => {
    const tenant = await newTenant('catprop-handoff');
    await pg.query(`update public.contacts set email = $2 where id = $1`, [tenant.customerId, `owner-${randomUUID().slice(0, 8)}@example.test`]);
    const built = await buildCatalogProposal(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 1 }] });
    const visitor = await recipientOf(tenant, built.id);
    await acceptCommercialProposal(visitor, { proposalId: built.id });

    const organizationsBefore = (await pg.query(`select count(*)::int as n from public.organizations`)).rows[0].n;
    await pg.query(`insert into public.platform_staff (user_id, name, capabilities) values ($1, 'Seller (test staff)', $2)`, [tenant.userId, ['platform.organizations']]);
    try {
      const { error } = await tenant.db.rpc('hand_off_accepted_proposal', { p_proposal_id: built.id });
      expect(error?.code).toBe('42501');
      expect(error?.message).toMatch(/Platform Plan/);
    } finally {
      await pg.query(`delete from public.platform_staff where user_id = $1`, [tenant.userId]);
    }
    expect((await pg.query(`select count(*)::int as n from public.customer_proposal_handoffs where proposal_id = $1`, [built.id])).rows[0].n).toBe(0);
    expect((await pg.query(`select count(*)::int as n from public.organizations`)).rows[0].n).toBe(organizationsBefore);
  });

  it('is still refused to an ordinary seller, as it always was', async () => {
    const { error } = await alice.db.rpc('hand_off_accepted_proposal', { p_proposal_id: randomUUID() });
    expect(error?.code).toBe('42501');
  });
});

describe('Platform Plan proposals made before this slice', () => {
  it('still read as they were, and a catalog version follows them in the same history', async () => {
    const tenant = await newTenant('catprop-legacy');
    const start = await getPlan(tenant.db, 'start');
    const extra = await getPlan(tenant.db, 'additional_user');
    const legacy = await seedLegacyPlanProposal({
      organizationId: tenant.organizationId, customerId: tenant.customerId, createdBy: tenant.userId,
      planId: start!.id, addonPlanIds: [extra!.id], currency: 'CAD', billingInterval: 'month',
    });
    const next = await buildCatalogProposal(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 1 }] });

    const [latest, old] = await listCommercialProposals(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId });
    expect(latest).toMatchObject({ id: next.id, version: 2, supersedesId: legacy.id, basis: 'catalog' });
    expect(old).toMatchObject({ id: legacy.id, version: 1, basis: 'platform_plan', planId: start!.id, planLabel: start!.label, billingInterval: 'month', catalogTotalMinor: null, lines: [] });
    expect(old.addons).toHaveLength(1);
    expect(commercialProposalTotalMinor(old)).toBe(old.planPriceMinor + old.addonPriceMinor);
  });
});
