import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { foundBusiness } from '@/tests/support/founding';

/**
 * `bookable_resources` and `resource_commitments` are definer views on purpose: they give a
 * booking visitor the two facts a booking needs — which resources exist, and when they are
 * taken — without a policy on `resources` or `work_items` that would expose every column.
 * `booking.test.ts` proves the flag and the column list and that a visitor bound to one business
 * sees nothing of another. This proves the rest of the boundary from the other callers: a member
 * of another business, a visitor bound to nobody, a caller with no session, and a caller who
 * tries to widen the view with the filters PostgREST lets them write.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Business = { db: SupabaseClient; organizationId: string; resourceId: string };

let pg: Client;
let alpha: Business;
let beta: Business;
let boundToAlpha: SupabaseClient;
let unbound: SupabaseClient;

function fresh(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function newBusiness(label: string): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = fresh();
  expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'EUR' });

  const typeId = await createWorkItemType(db, { organizationId, name: 'Job' });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Booked' });
  const resourceId = await createResource(db, { organizationId, name: `Van ${label}` });

  // A job holding the resource for an hour, so there is a commitment to see or be refused.
  const created2 = await db.rpc('create_work_item', {
    p_organization_id: organizationId,
    p_title: `Secret job ${label}`,
    p_status_id: statusId,
    p_resource_id: resourceId,
    p_customer_id: null,
    p_location_id: null,
    p_asset_id: null,
    p_custom: {},
  });
  expect(created2.error).toBeNull();
  const start = new Date(Date.now() + 86_400_000);
  const scheduled = await db.rpc('schedule_work_item', {
    p_work_item_id: created2.data as string,
    p_resource_id: resourceId,
    p_starts_at: start.toISOString(),
    p_ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
  });
  expect(scheduled.error).toBeNull();
  return { db, organizationId, resourceId };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  alpha = await newBusiness('rv-alpha');
  beta = await newBusiness('rv-beta');

  boundToAlpha = fresh();
  const signedIn = await boundToAlpha.auth.signInAnonymously();
  expect(signedIn.error).toBeNull();
  await pg.query('insert into public.external_actors (organization_id, user_id) values ($1, $2)', [
    alpha.organizationId,
    signedIn.data.user?.id,
  ]);

  unbound = fresh();
  expect((await unbound.auth.signInAnonymously()).error).toBeNull();
}, 120_000);

afterAll(async () => {
  await pg.end();
});

describe('resource_commitments', () => {
  it('shows a visitor bound to a business that business’s commitments and nothing else', async () => {
    const { data, error } = await boundToAlpha.from('resource_commitments').select('organization_id, resource_id');
    expect(error).toBeNull();
    expect(data).toEqual([{ organization_id: alpha.organizationId, resource_id: alpha.resourceId }]);
  });

  it('shows a member their own business only, never another’s', async () => {
    const own = await beta.db.from('resource_commitments').select('organization_id');
    expect(own.data?.map((row) => row.organization_id)).toEqual([beta.organizationId]);

    const other = await beta.db.from('resource_commitments').select('resource_id').eq('organization_id', alpha.organizationId);
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
  });

  it('shows a visitor bound to nobody nothing', async () => {
    const { data, error } = await unbound.from('resource_commitments').select('resource_id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('refuses a caller with no session before the view is consulted', async () => {
    const { data, error } = await fresh().from('resource_commitments').select('resource_id');
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('cannot be widened by a filter: an or-clause naming both businesses still returns only the caller’s', async () => {
    const { data, error } = await boundToAlpha
      .from('resource_commitments')
      .select('organization_id')
      .or(`organization_id.eq.${alpha.organizationId},organization_id.eq.${beta.organizationId}`);
    expect(error).toBeNull();
    expect([...new Set(data?.map((row) => row.organization_id))]).toEqual([alpha.organizationId]);
  });

  it('never carries what the job is: asking for a title or a customer is an error, not a row', async () => {
    for (const column of ['title', 'customer_id', 'status_id', 'custom']) {
      const { data, error } = await boundToAlpha.from('resource_commitments').select(column);
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }
  });
});

describe('bookable_resources', () => {
  it('shows a bound visitor the ids of that business’s resources', async () => {
    const { data, error } = await boundToAlpha.from('bookable_resources').select('organization_id, id');
    expect(error).toBeNull();
    expect(data).toEqual([{ organization_id: alpha.organizationId, id: alpha.resourceId }]);
  });

  it('shows nothing to a member of any business — it is the outside world’s view, not theirs', async () => {
    const { data, error } = await beta.db.from('bookable_resources').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('shows nothing to a visitor bound to nobody', async () => {
    const { data, error } = await unbound.from('bookable_resources').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('refuses a caller with no session', async () => {
    const { data, error } = await fresh().from('bookable_resources').select('id');
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('cannot be pointed at another business by a filter, and never carries a name', async () => {
    const other = await boundToAlpha.from('bookable_resources').select('id').eq('organization_id', beta.organizationId);
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);

    const named = await boundToAlpha.from('bookable_resources').select('name');
    expect(named.data).toBeNull();
    expect(named.error).not.toBeNull();
  });
});
