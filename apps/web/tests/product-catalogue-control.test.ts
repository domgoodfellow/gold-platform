import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getProduct,
  listProductPrices,
  listProducts,
  productKeyFromUrlSegment,
  productKeyToUrlSegment,
  recordProductPrice,
  updateProduct,
} from '@/lib/domain/commercial/catalogue';
import { listOrganizationTerms, recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { asPlatformStaff, newAccountEmail } from './helpers/founding';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function signedInStranger(): Promise<SupabaseClient> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `catalogue-stranger-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return db;
}

describe('staff-managed product catalogue', () => {
  let staff: SupabaseClient;
  let stranger: SupabaseClient;
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Local Supabase credentials are required.');
    [staff, stranger] = await Promise.all([asPlatformStaff(), signedInStranger()]);
  });

  it('keeps a tenant agreement unchanged when the global list price changes', async () => {
    const organizationId = await provisionOrganization(staff, { ownerEmail: await newAccountEmail('nextfund'), name: 'NextFund', displayName: 'NextFund Owner', currency: 'CAD', timezone: 'America/Toronto' });
    const termId = await recordCommercialTerm(staff, { organizationId, productKey: 'module:reporting', periodStart: '2026-09-01', periodEnd: '2027-08-31', priceMinor: 12500, currency: 'CAD' });
    await recordProductPrice(staff, { productKey: 'module:reporting', currency: 'CAD', amountMinor: 14900, billingInterval: 'month', effectiveFrom: new Date().toISOString(), source: 'Current rate card' });
    expect((await listOrganizationTerms(staff, { organizationId })).find((term) => term.id === termId)).toMatchObject({ priceMinor: 12500, currency: 'CAD' });
    expect((await listProductPrices(staff)).some((price) => price.amountMinor === 14900)).toBe(true);
  });

  it('allows only staff to change mutable product metadata', async () => {
    const product = (await listProducts(staff)).find((entry) => entry.key === 'module:billing')!;
    await expect(updateProduct(stranger, product)).rejects.toMatchObject({ code: 'commercial.update_product_failed' });
    await updateProduct(staff, { ...product, description: 'Quotes, invoices, payments, and tenant billing.' });
    expect((await listProducts(staff)).find((entry) => entry.key === product.key)?.description).toContain('invoices');
  });

  it('reads one product by its key, or null for one that does not exist', async () => {
    expect(await getProduct(staff, 'module:billing')).toMatchObject({ key: 'module:billing' });
    expect(await getProduct(staff, 'module:does-not-exist')).toBeNull();
  });

  it('round-trips a product key through its URL spelling, including the colon a key always carries', async () => {
    // `platform_products.key` is `kind:name` for a module or a seat — a real colon, not
    // decoration. Next's dynamic route matching does not resolve `[productKey]` correctly when
    // the requested path segment contains one (confirmed empirically against a running server:
    // both an unencoded and a percent-encoded colon 404, while the identical route with no
    // colon in the key resolves), so the record route spells it with `~` instead and this
    // proves the round trip rather than only the browser page that depends on it.
    for (const key of ['module:billing', 'seat:reception_agent', 'platform_base']) {
      const segment = productKeyToUrlSegment(key);
      expect(segment).not.toContain(':');
      expect(productKeyFromUrlSegment(segment)).toBe(key);
    }
  });
});
