import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setPublicProfile } from '@/lib/domain/tenancy/profile';
import { setBrand } from '@/lib/domain/branding/brand';
import { foundBusiness } from '@/tests/support/founding';

const updateTag = vi.fn();
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, updateTag }));
// Next's bundler recognizes this package specially and needs it installed nowhere; vitest's
// plain module resolution does not, so the import `lib/db/public.ts` makes must be stubbed here.
vi.mock('server-only', () => ({}));

const { invalidateGoldHomepageIfReferenced } = await import('@/lib/domain/public-site/cached');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; email: string };
let published: Tenant;
let unrelated: Tenant;
let previousSite: string | null;
let previousSiteOrganization: string | null;

async function signUp(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, email };
}

async function newTenant(label: string): Promise<Tenant> {
  const account = await signUp(label);
  const organizationId = await foundBusiness({ ownerEmail: account.email, name: `${label} Ltd`, displayName: 'Owner', timezone: 'America/Toronto', currency: 'CAD' });
  return { ...account, organizationId };
}

async function pgQuery(text: string, values: unknown[] = []) {
  const pg = new Client(CONNECTION); await pg.connect();
  try { return await pg.query(text, values); } finally { await pg.end(); }
}

describe('profile and brand writes invalidate the public projection they feed', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Supabase test keys must be set.');
    published = await newTenant('cache-invalidation-published');
    unrelated = await newTenant('cache-invalidation-unrelated');
    const previous = (await pgQuery('select gold_public_organization_id,gold_public_site_id from public.platform_settings where singleton')).rows[0];
    previousSite = previous.gold_public_site_id;
    previousSiteOrganization = previous.gold_public_organization_id;
    await pgQuery('select app.bootstrap_gold_public_site($1)', [published.organizationId]);
  });

  afterAll(async () => {
    await pgQuery('update public.platform_settings set gold_public_organization_id=$1,gold_public_site_id=$2 where singleton', [previousSiteOrganization, previousSite]);
  });

  it('expires the homepage cache tag when the organization behind the projection changes its profile', async () => {
    updateTag.mockClear();
    await setPublicProfile(published.db, {
      organizationId: published.organizationId,
      displayName: 'Renamed for the public page',
      tagline: '', intro: '', contactEmail: '', contactPhone: '', address: '',
    });
    await invalidateGoldHomepageIfReferenced(published.db, published.organizationId);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith('public-site:gold:home');
  });

  it('expires the homepage cache tag when that organization changes its brand', async () => {
    updateTag.mockClear();
    await setBrand(published.db, { organizationId: published.organizationId, accent: '#1f6feb', headingFont: 'sans', bodyFont: 'sans' });
    await invalidateGoldHomepageIfReferenced(published.db, published.organizationId);
    expect(updateTag).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone when the changed organization is not the one currently published', async () => {
    updateTag.mockClear();
    await setPublicProfile(unrelated.db, {
      organizationId: unrelated.organizationId,
      displayName: 'Some other business',
      tagline: '', intro: '', contactEmail: '', contactPhone: '', address: '',
    });
    await setBrand(unrelated.db, { organizationId: unrelated.organizationId, accent: '#111111', headingFont: 'sans', bodyFont: 'sans' });
    await invalidateGoldHomepageIfReferenced(unrelated.db, unrelated.organizationId);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
