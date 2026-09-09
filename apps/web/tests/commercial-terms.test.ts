import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { connectPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { listOrganizationTerms, moduleCommercialState, recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { asPlatformStaff, foundBusiness } from './helpers/founding';

/**
 * D41, built: the wanted∩paid intersection, and the four states it produces.
 *
 * The claim worth testing is the middle two states — the ones D41 exists for. "On" and
 * "absent" were already true by construction (a row exists or it does not); "switched on but
 * unpaid" and "paid but switched off" are the two this migration actually adds meaning to, and
 * the first of them is also where the write-refusal trigger lives (`payment_accounts`, the
 * `card_payments` pilot — see `constraints.md` D43's fourth amendment for why only one table).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function newTenant(label: string): Promise<{ db: SupabaseClient; organizationId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
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

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd ${randomUUID().slice(0, 6)}`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, organizationId };
}

describe('D41: wanted, paid, and their intersection', () => {
  let staff: SupabaseClient;
  let tenant: { db: SupabaseClient; organizationId: string };

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    staff = await asPlatformStaff();
    tenant = await newTenant('term-states');
  });

  it('backfills the founding modules with a usable term, unprompted', async () => {
    // Founding grants billing and drafting for free (app.grant_founding_terms) — proven here
    // rather than assumed, since a regression here would silently brick every new business.
    const states = await moduleCommercialState(tenant.db, { organizationId: tenant.organizationId });
    const billing = states.find((state) => state.moduleKey === 'billing');
    expect(billing).toMatchObject({ wanted: true, paid: true });
  });

  it('produces all four states', async () => {
    // Wanted, not paid: switched on with no term behind it.
    await setModuleEnabled(tenant.db, { organizationId: tenant.organizationId, key: 'assets', enabled: true });

    // Paid, not wanted: staff records a term for a module this business never switched on.
    await recordCommercialTerm(staff, {
      organizationId: tenant.organizationId,
      productKey: 'module:reporting',
      periodStart: '2026-01-01',
      periodEnd: '9999-12-31',
      priceMinor: 500,
      currency: 'EUR',
    });

    const states = await moduleCommercialState(tenant.db, { organizationId: tenant.organizationId });
    const byKey = new Map(states.map((state) => [state.moduleKey, state]));

    expect(byKey.get('assets')).toMatchObject({ wanted: true, paid: false });
    expect(byKey.get('reporting')).toMatchObject({ wanted: false, paid: true });
    expect(byKey.get('billing')).toMatchObject({ wanted: true, paid: true });
    // Absent — never named on either side — produces no row at all.
    expect(byKey.has('portal')).toBe(false);
  });

  it('refuses a write to a module-owned table while wanted but unpaid, and allows it once a term exists', async () => {
    await setModuleEnabled(tenant.db, { organizationId: tenant.organizationId, key: 'card_payments', enabled: true });

    // Wanted, not paid: the entitlement trigger on payment_accounts refuses the insert. Nothing
    // about the module switch itself is touched — only the write this module owns.
    await expect(
      connectPaymentAccount(tenant.db, {
        organizationId: tenant.organizationId,
        provider: 'test-processor',
        account: { accountId: 'acct_before_term' },
      }),
    ).rejects.toBeTruthy();

    await recordCommercialTerm(staff, {
      organizationId: tenant.organizationId,
      productKey: 'module:card_payments',
      periodStart: '2026-01-01',
      periodEnd: '9999-12-31',
      priceMinor: 1000,
      currency: 'EUR',
    });

    await expect(
      connectPaymentAccount(tenant.db, {
        organizationId: tenant.organizationId,
        provider: 'test-processor',
        account: { accountId: 'acct_after_term' },
      }),
    ).resolves.toBeUndefined();
  });

  it('is nobody\'s to write directly — not the tenant, not staff, only app.record_commercial_term', async () => {
    const { error: tenantError } = await tenant.db.from('organization_commercial_terms').insert({
      organization_id: tenant.organizationId,
      product_key: 'module:billing',
      period_start: '2026-01-01',
      period_end: '2026-02-01',
      price_minor: 0,
    });
    expect(tenantError).toBeTruthy();

    const { error: staffError } = await staff.from('organization_commercial_terms').insert({
      organization_id: tenant.organizationId,
      product_key: 'module:billing',
      period_start: '2026-01-01',
      period_end: '2026-02-01',
      price_minor: 0,
    });
    expect(staffError).toBeTruthy();
  });

  it('refuses an overlapping term for the same product and business', async () => {
    await recordCommercialTerm(staff, {
      organizationId: tenant.organizationId,
      productKey: 'module:automations',
      periodStart: '2026-03-01',
      periodEnd: '2026-04-01',
      priceMinor: 200,
      currency: 'EUR',
    });

    await expect(
      recordCommercialTerm(staff, {
        organizationId: tenant.organizationId,
        productKey: 'module:automations',
        periodStart: '2026-03-15',
        periodEnd: '2026-05-01',
        priceMinor: 200,
        currency: 'EUR',
      }),
    ).rejects.toMatchObject({ code: 'commercial.term_overlap' });

    const terms = await listOrganizationTerms(tenant.db, { organizationId: tenant.organizationId });
    expect(terms.filter((term) => term.productKey === 'module:automations')).toHaveLength(1);
  });
});
