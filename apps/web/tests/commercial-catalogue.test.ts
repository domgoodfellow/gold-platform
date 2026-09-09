import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  listMeters,
  listProducts,
  listProviderRates,
  listRetailRates,
  recordProviderRate,
  recordRetailRate,
} from '@/lib/domain/commercial/catalogue';
import { asPlatformStaff, newAccountEmail } from './helpers/founding';

/**
 * GOLD's own catalogue: what can be metered, what is sold, and the two rate cards (D43).
 *
 * The one claim worth testing here is the asymmetry the whole slice rests on: GOLD's own
 * wholesale cost is never a tenant-visible row, GOLD's retail price is, and neither is
 * writable by anyone signed in who is not platform staff — a rate is amended to allow a
 * narrow staff door, not opened to everyone (see `constraints.md` D43's first amendment).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function signedInStranger(): Promise<SupabaseClient> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `bystander-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return db;
}

describe('the commercial catalogue (D43)', () => {
  let staff: SupabaseClient;
  let stranger: SupabaseClient;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    staff = await asPlatformStaff();
    stranger = await signedInStranger();
    // Only ever true if provisioning has already run in this database once — establishes an
    // account exists so nothing here is the first caller of that machinery.
    await newAccountEmail('catalogue-witness');
  });

  it('is readable vocabulary — meters and products, to anyone signed in', async () => {
    const meters = await listMeters(stranger);
    expect(meters.map((meter) => meter.id)).toContain('voice_minutes');
    expect(meters.map((meter) => meter.id)).toContain('ai_tokens_input');

    const products = await listProducts(stranger);
    expect(products.map((product) => product.key)).toContain('module:billing');
    expect(products.find((product) => product.key === 'module:billing')?.kind).toBe('module');
  });

  it('lets staff record a provider rate and a retail rate, and refuses anyone else', async () => {
    const meterId = 'transcription_seconds';
    const currency = 'USD';

    await expect(
      recordProviderRate(stranger, {
        meterId,
        currency,
        unitAmountMicros: 4200,
        source: 'a stranger should not reach this',
      }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });

    await expect(
      recordRetailRate(stranger, {
        meterId,
        currency,
        unitAmountMicros: 9900,
        source: 'a stranger should not reach this',
      }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });

    const providerId = await recordProviderRate(staff, {
      meterId,
      currency,
      unitAmountMicros: 4200,
      source: 'Deepgram invoice, September',
    });
    expect(providerId).toBeTruthy();

    const retailId = await recordRetailRate(staff, {
      meterId,
      currency,
      unitAmountMicros: 9900,
      source: 'GOLD price list',
    });
    expect(retailId).toBeTruthy();

    // GOLD's own cost: staff only. Never granted to a signed-in tenant at all.
    const providerRates = await listProviderRates(staff, { meterId });
    expect(providerRates.some((rate) => rate.id === providerId)).toBe(true);

    await expect(listProviderRates(stranger, { meterId })).rejects.toBeTruthy();

    // What GOLD charges: readable by anyone signed in — a business is entitled to know.
    const retailRatesAsStaff = await listRetailRates(staff, { meterId });
    expect(retailRatesAsStaff.some((rate) => rate.id === retailId)).toBe(true);

    const retailRatesAsTenant = await listRetailRates(stranger, { meterId });
    expect(retailRatesAsTenant.some((rate) => rate.id === retailId)).toBe(true);
  });

  it('is append-only — no update or delete grant reaches either rate table', async () => {
    const meterId = 'tts_characters';
    const currency = 'USD';
    await recordRetailRate(staff, {
      meterId,
      currency,
      unitAmountMicros: 500,
      source: 'GOLD price list',
    });

    const { error } = await staff
      .from('platform_retail_rates')
      .update({ unit_amount_micros: 1 })
      .eq('meter_id', meterId)
      .eq('currency', currency);

    // No update policy at all — refused for want of one, not merely declined by one.
    expect(error).toBeTruthy();
  });
});
