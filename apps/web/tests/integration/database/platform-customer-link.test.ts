import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { foundBusiness } from '@/tests/support/founding';
import { setAsideOperatingOrganization } from '@/tests/support/operating-organization';

/**
 * Every business GildOps serves is one of GildOps' customers (ADR-057, decision 5). The backfill
 * that links businesses holding a GildOps plan to a customer in GildOps' CRM must link each one
 * once, reuse a customer it already had, leave existing links alone and never reach another
 * business's records.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let operator: Person;
let tenantOwner: Person;
let gildops: string;
let unlinked: string;
let previouslyEnded: string;
let alreadyLinked: string;
let endedCustomer: string;
let existingRelationship: string;

async function person(label: string, options: { staff?: boolean } = {}): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (options.staff) await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [created.data.user.id, 'Operator']);
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

async function assignStart(organizationId: string): Promise<void> {
  await pg.query(
    `insert into public.organization_plan_assignments (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by, note)
     select $1, id, 'plan', '2026-01-01', '9999-12-31', $2, 'test' from public.platform_plans where key = 'start'`,
    [organizationId, operator.userId],
  );
}

async function contact(organizationId: string, name: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.contacts (organization_id, name, contact_type, lifecycle, created_by) values ($1, $2, 'company', 'customer', $3) returning id`,
    [organizationId, name, operator.userId],
  );
  return rows[0].id;
}

async function link(): Promise<number> {
  const { rows } = await pg.query<{ created: number }>('select app.link_platform_customers() as created');
  return rows[0].created;
}

async function relationshipsWith(tenant: string) {
  const { rows } = await pg.query<{ id: string; customer_id: string; origin: string; status: string; name: string; contact_type: string; lifecycle: string }>(
    `select r.id, r.customer_id, r.origin, r.status, c.name, c.contact_type, c.lifecycle
       from public.client_tenant_relationships r join public.contacts c on c.id = r.customer_id
      where r.organization_id = $1 and r.tenant_organization_id = $2 order by r.created_at`,
    [gildops, tenant],
  );
  return rows;
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);

  operator = await person('gildops-operator', { staff: true });
  tenantOwner = await person('tenant-owner');
  gildops = await foundBusiness({ ownerEmail: operator.email, name: `GildOps ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  unlinked = await foundBusiness({ ownerEmail: tenantOwner.email, name: `Unlinked ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  previouslyEnded = await foundBusiness({ ownerEmail: tenantOwner.email, name: `Ended ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  alreadyLinked = await foundBusiness({ ownerEmail: tenantOwner.email, name: `Linked ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  for (const tenant of [unlinked, previouslyEnded, alreadyLinked]) await assignStart(tenant);
}, 120_000);

afterAll(async () => {
  try {
    await restore?.();
  } finally {
    await pg.end();
  }
});

describe('linking GildOps buyers to GildOps customers', () => {
  it('does nothing while no operating organization is configured', async () => {
    expect(await link()).toBe(0);
    expect(await relationshipsWith(unlinked)).toEqual([]);
  });

  describe('once GildOps is the operating organization', () => {
    beforeAll(async () => {
      await bootstrapOperatingOrganization(operator.db, { organizationId: gildops });
      endedCustomer = await contact(gildops, 'Ended Co');
      await pg.query(
        `insert into public.client_tenant_relationships (organization_id, customer_id, tenant_organization_id, status, origin, authority_basis, created_by, ended_at, ended_by)
         values ($1, $2, $3, 'ended', 'existing_tenant_link', 'Earlier link', $4, now(), $4)`,
        [gildops, endedCustomer, previouslyEnded, operator.userId],
      );
      const linkedCustomer = await contact(gildops, 'Linked Co');
      const { rows } = await pg.query<{ id: string }>(
        `insert into public.client_tenant_relationships (organization_id, customer_id, tenant_organization_id, origin, authority_basis, created_by)
         values ($1, $2, $3, 'existing_tenant_link', 'Approved link', $4) returning id`,
        [gildops, linkedCustomer, alreadyLinked, operator.userId],
      );
      existingRelationship = rows[0].id;
      await link();
    }, 60_000);

    it('creates a company customer named after an unlinked business, with an active link recorded as a migration', async () => {
      const name = (await pg.query<{ name: string }>('select name from public.organizations where id = $1', [unlinked])).rows[0].name;
      expect(await relationshipsWith(unlinked)).toEqual([
        expect.objectContaining({ origin: 'migration', status: 'active', name, contact_type: 'company', lifecycle: 'customer' }),
      ]);
      const { rows } = await pg.query<{ payload: { origin: string; tenantOrganizationId: string } }>(
        `select payload from public.events where organization_id = $1 and action = 'customer.created' and entity_id = $2`,
        [gildops, (await relationshipsWith(unlinked))[0].customer_id],
      );
      expect(rows).toEqual([{ payload: { origin: 'migration', tenantOrganizationId: unlinked } }]);
    });

    it('reuses the customer of an ended link rather than creating another', async () => {
      const rows = await relationshipsWith(previouslyEnded);
      expect(rows.map((row) => [row.status, row.origin, row.customer_id])).toEqual([
        ['ended', 'existing_tenant_link', endedCustomer],
        ['active', 'migration', endedCustomer],
      ]);
    });

    it('leaves a business that is already linked alone, and never links GildOps to itself', async () => {
      expect((await relationshipsWith(alreadyLinked)).map((row) => row.id)).toEqual([existingRelationship]);
      expect(await relationshipsWith(gildops)).toEqual([]);
    });

    it('creates nothing on a second run', async () => {
      expect(await link()).toBe(0);
    });

    it('keeps the new customers inside GildOps’ organization', async () => {
      const customer = (await relationshipsWith(unlinked))[0].customer_id;
      const { data } = await tenantOwner.db.from('contacts').select('id').eq('id', customer);
      expect(data).toEqual([]);
    });
  });
});
