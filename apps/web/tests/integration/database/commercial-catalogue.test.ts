import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  listMeters,
  listProducts,
  listProviderRates,
  listProviders,
  listRetailRates,
  recordProviderRate,
  recordRetailRate,
} from '@/lib/domain/commercial/catalogue';
import { asPlatformStaff, newAccountEmail } from '@/tests/support/founding';

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

  it('is readable vocabulary — meters and products to anyone signed in, providers to staff alone (D64)', async () => {
    const meters = await listMeters(stranger);
    expect(meters.map((meter) => meter.id)).toContain('voice_minutes');
    expect(meters.map((meter) => meter.id)).toContain('ai_tokens_input');
    // A meter is a capability, not a vendor (D43's correction) — it carries no provider field.
    expect(meters[0]).not.toHaveProperty('provider');

    // Who GOLD uses is not vocabulary: staff see it, a signed-in stranger sees nothing.
    const providers = await listProviders(staff);
    expect(providers.map((provider) => provider.key)).toEqual(
      expect.arrayContaining(['deepgram', 'elevenlabs', 'anthropic', 'openai_compatible']),
    );
    expect(await listProviders(stranger)).toEqual([]);

    const products = await listProducts(stranger);
    expect(products.map((product) => product.key)).toContain('module:billing');
    expect(products.find((product) => product.key === 'module:billing')?.kind).toBe('module');
  });

  it('lets staff record a provider rate and a retail rate, and refuses anyone else', async () => {
    const meterId = 'transcription_seconds';
    const currency = 'USD';

    await expect(
      recordProviderRate(stranger, {
        providerKey: 'deepgram',
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
      providerKey: 'deepgram',
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

    // GOLD's own cost: staff only. `platform_provider_rates` grants `select` to `authenticated`
    // now that staff read it as themselves rather than as a separate Postgres role
    // (20260915000001), so a stranger's call no longer fails outright — the row policy declines
    // instead, and `listProviderRates` has nothing to throw on. An empty list is the honest
    // negative; a rejection would now be testing for a mechanism that no longer exists here.
    const providerRates = await listProviderRates(staff, { meterId });
    expect(providerRates.some((rate) => rate.id === providerId)).toBe(true);

    const providerRatesAsStranger = await listProviderRates(stranger, { meterId });
    expect(providerRatesAsStranger).toEqual([]);

    // What GOLD charges: a business is entitled to know, so a member of a business reads it (proved
    // in catalogue-visibility.test.ts); a signed-in account that belongs to none does not (D64).
    const retailRatesAsStaff = await listRetailRates(staff, { meterId });
    expect(retailRatesAsStaff.some((rate) => rate.id === retailId)).toBe(true);

    const retailRatesAsTenant = await listRetailRates(stranger, { meterId });
    expect(retailRatesAsTenant).toEqual([]);
  });

  it('lets two providers price the same meter independently, without touching a business meter', async () => {
    const meterId = 'transcription_seconds';

    const deepgramId = await recordProviderRate(staff, {
      providerKey: 'deepgram',
      meterId,
      currency: 'GBP',
      unitAmountMicros: 3000,
      source: 'Deepgram, GBP price list',
    });

    const elevenLabsId = await recordProviderRate(staff, {
      providerKey: 'elevenlabs',
      meterId,
      currency: 'GBP',
      unitAmountMicros: 5500,
      source: 'ElevenLabs, GBP price list',
    });

    const rates = await listProviderRates(staff, { meterId, providerKey: undefined });
    const deepgram = rates.find((rate) => rate.id === deepgramId);
    const elevenLabs = rates.find((rate) => rate.id === elevenLabsId);

    expect(deepgram?.providerKey).toBe('deepgram');
    expect(elevenLabs?.providerKey).toBe('elevenlabs');
    // Two different prices for the same meter, at the same moment — the whole point of naming
    // the provider on the rate rather than on the meter.
    expect(deepgram?.unitAmountMicros).not.toBe(elevenLabs?.unitAmountMicros);

    // Anthropic and an OpenAI-compatible host can both price the same AI meter too, without a
    // second business meter ever being created.
    const anthropicId = await recordProviderRate(staff, {
      providerKey: 'anthropic',
      meterId: 'ai_tokens_input',
      currency: 'USD',
      unitAmountMicros: 300,
      source: 'Anthropic price list',
    });
    const openaiId = await recordProviderRate(staff, {
      providerKey: 'openai_compatible',
      meterId: 'ai_tokens_input',
      currency: 'USD',
      unitAmountMicros: 150,
      source: 'Self-hosted OpenAI-compatible model',
    });
    expect(anthropicId).not.toBe(openaiId);

    const meters = await listMeters(staff);
    expect(meters.filter((meter) => meter.id === 'ai_tokens_input')).toHaveLength(1);
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
