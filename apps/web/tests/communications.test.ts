import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  communicationsAccount,
  creditBalance,
  listCreditEntries,
} from '@/lib/domain/communications/credits';
import { recordCall } from '@/lib/domain/reception/calls';
import { foundBusiness } from './helpers/founding';

/**
 * The communications engine: one purse, and a refusal that lives in the database.
 *
 * **The assertion that carries this slice is that a business cannot credit itself.** Everything
 * else here is arithmetic; that one is the reason no policy on `communication_credits` permits
 * an insert by anybody signed in. A capability withheld would be a capability somebody could
 * grant themselves through the roles screen.
 *
 * **The rate table is written over a direct connection**, the way `platform_staff` is in the
 * demo builder and for the same reason: no application path may write one, deliberately, so a
 * test that needed one through the application would be evidence the boundary had a hole.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// A currency nobody else's test trades in, so pricing it cannot change what another suite sees.
// `communication_rates` has no tenant to scope it by — that is the point of the table — so
// isolation here is by currency rather than by organization.
const PRICED = 'XTS';

type Tenant = { db: SupabaseClient; organizationId: string };

let priced: Tenant;
let unpriced: Tenant;
let pg: Client;

async function newTenant(label: string, currency: string): Promise<Tenant> {
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

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency,
  });

  return { db, organizationId };
}

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  // Ten cents a minute, in a currency invented for this file.
  await pg.query(
    `insert into public.communication_rates (currency, channel, unit_amount_minor)
     values ($1, 'voice', 10)
     on conflict (currency, channel) do update set unit_amount_minor = excluded.unit_amount_minor`,
    [PRICED],
  );

  [priced, unpriced] = await Promise.all([
    newTenant('priced', PRICED),
    newTenant('unpriced', 'CAD'),
  ]);
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

describe('a purse', () => {
  it('starts empty, and an empty purse is a number rather than an absence', async () => {
    expect(await creditBalance(priced.db, { organizationId: priced.organizationId })).toEqual(0);
  });

  it('cannot be topped up by the business holding it', async () => {
    // **The assertion this file exists for.** No policy permits the insert, so a member who
    // holds every capability their business can grant still cannot give themselves money.
    const { error } = await priced.db.from('communication_credits').insert({
      organization_id: priced.organizationId,
      amount_minor: 100_000,
      currency: PRICED,
      reason: 'purchase',
      note: 'a gift to myself',
    });

    expect(error).not.toBeNull();
    expect(await creditBalance(priced.db, { organizationId: priced.organizationId })).toEqual(0);
  });

  it('is invisible to another business (I1)', async () => {
    await pg.query(
      `insert into public.communication_credits
         (organization_id, amount_minor, currency, reason, note)
       values ($1, 5000, $2, 'purchase', 'opening credit')`,
      [priced.organizationId, PRICED],
    );

    expect(await creditBalance(priced.db, { organizationId: priced.organizationId })).toEqual(5000);
    // Asked with the other tenant's id, by a caller who is not in it. RLS makes the rows absent
    // rather than denied, so the sum of nothing is nothing.
    expect(await creditBalance(unpriced.db, { organizationId: priced.organizationId })).toEqual(0);
  });

  it('reads back as a statement anybody in the business can see', async () => {
    const entries = await listCreditEntries(priced.db, {
      organizationId: priced.organizationId,
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].reason).toEqual('purchase');
    expect(entries[0].currency).toEqual(PRICED);
  });
});

describe('what a deployment charges', () => {
  it('says a business is unpriced when nothing has been priced in its currency', async () => {
    // The ordinary case, and the one that must keep working: a deployment that has decided no
    // prices charges nothing, draws nothing down, and refuses nothing.
    const account = await communicationsAccount(unpriced.db, {
      organizationId: unpriced.organizationId,
      currency: 'CAD',
    });
    expect(account.priced).toBe(false);
    expect(account.rates).toEqual([]);
  });

  it('shows a business what it is being charged, because it is entitled to know', async () => {
    const account = await communicationsAccount(priced.db, {
      organizationId: priced.organizationId,
      currency: PRICED,
    });
    expect(account.priced).toBe(true);
    expect(account.rates[0].unitAmountMinor).toEqual(10);
    expect(account.rates[0].channel).toEqual('voice');
  });
});

describe('the refusal', () => {
  it('lets an unpriced business keep working exactly as before', async () => {
    // Credit is opt-in per deployment. A business whose channels cost nothing must never be
    // stopped by a purse it was never asked to fill.
    const customerId = await createCustomer(unpriced.db, {
      organizationId: unpriced.organizationId,
      name: 'Unpriced Ltd',
    });

    const callId = await recordCall(unpriced.db, {
      organizationId: unpriced.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    expect(callId).toBeTruthy();
  });

  it('refuses to open a call for a priced business with an empty purse', async () => {
    const empty = await newTenant('empty', PRICED);
    const customerId = await createCustomer(empty.db, {
      organizationId: empty.organizationId,
      name: 'Skint Ltd',
    });

    // Called through the database function rather than through `placeCall`, because what is
    // being tested is the guard rather than the carrier: `placeCall` would refuse earlier for
    // want of a provider, and would prove nothing about the money.
    const { error } = await empty.db.rpc('open_call', {
      p_organization_id: empty.organizationId,
      p_customer_id: customerId,
      p_conference_name: `gold-${randomUUID()}`,
      p_from_number: '+14165550100',
      p_to_number: '+14165550142',
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? '').toContain('no calling credit');
  });

  it('opens a call once the purse has something in it', async () => {
    const customerId = await createCustomer(priced.db, {
      organizationId: priced.organizationId,
      name: 'Funded Ltd',
    });

    const { data, error } = await priced.db.rpc('open_call', {
      p_organization_id: priced.organizationId,
      p_customer_id: customerId,
      p_conference_name: `gold-${randomUUID()}`,
      p_from_number: '+14165550100',
      p_to_number: '+14165550142',
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });
});

describe('what a finished call costs', () => {
  it('draws down once, rounded up to the minute, and only when somebody spoke', async () => {
    const customerId = await createCustomer(priced.db, {
      organizationId: priced.organizationId,
      name: 'Charged Ltd',
    });
    const callId = await recordCall(priced.db, {
      organizationId: priced.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    const before = await creditBalance(priced.db, { organizationId: priced.organizationId });

    // Ninety seconds is two minutes on any telephone bill anybody has ever read.
    await pg.query('select app.charge_for_call($1, $2)', [callId, 90]);

    const after = await creditBalance(priced.db, { organizationId: priced.organizationId });
    expect(before - after).toEqual(20);

    const [entry] = await listCreditEntries(priced.db, {
      organizationId: priced.organizationId,
    });
    expect(entry.reason).toEqual('usage');
    expect(entry.channel).toEqual('voice');
    expect(entry.amountMinor).toEqual(-20);
  });

  it('charges nothing for a call nobody answered', async () => {
    const customerId = await createCustomer(priced.db, {
      organizationId: priced.organizationId,
      name: 'Rang Out Ltd',
    });
    const callId = await recordCall(priced.db, {
      organizationId: priced.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    const before = await creditBalance(priced.db, { organizationId: priced.organizationId });
    await pg.query('select app.charge_for_call($1, $2)', [callId, 0]);
    const after = await creditBalance(priced.db, { organizationId: priced.organizationId });

    expect(after).toEqual(before);
  });

  it('charges nothing in a currency nobody priced', async () => {
    const customerId = await createCustomer(unpriced.db, {
      organizationId: unpriced.organizationId,
      name: 'Free Ltd',
    });
    const callId = await recordCall(unpriced.db, {
      organizationId: unpriced.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    await pg.query('select app.charge_for_call($1, $2)', [callId, 600]);

    expect(
      await creditBalance(unpriced.db, { organizationId: unpriced.organizationId }),
    ).toEqual(0);
  });
});
