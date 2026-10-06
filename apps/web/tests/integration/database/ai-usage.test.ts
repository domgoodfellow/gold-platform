import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { foundBusiness } from '@/tests/support/founding';

/**
 * What an AI request consumed is written down by one door, and whether a business may spend on the
 * Agent is decided before it is spent. Both are facts about Postgres, so both are asked of it.
 *
 *   * `public.record_ai_usage` is the writer of `ai_tokens_input` and `ai_tokens_output`. It hands
 *     both to `app.record_usage` -- there is no second ledger -- is executable by one machine role,
 *     and is idempotent on its request reference.
 *   * `app.module_entitled` is the resolver the Python endpoints ask. `organizationResolvedFeatureStates`
 *     is the authoritative resolver the shell asks; the two must say the same thing, and the
 *     scenarios below hold them to it.
 *   * `public.organization_module_entitled` answers *no* for a business the caller is not in, so it
 *     cannot be used to learn about somebody else's.
 *   * `public.resolve_public_assistant` names a business, its owner's instructions and its
 *     entitlement from a deployment's own id, and answers nothing for one that is not live.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let pg: Client;
let alice: Tenant;
let bob: Tenant;
const planIds: string[] = [];

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'EUR' });
  return { db, userId: created.user.id, organizationId };
}

async function asProviderOperator<T>(run: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role provider_operator');
    return await run();
  } finally {
    await pg.query('rollback');
  }
}

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  alice = await newTenant('ai-usage-alice');
  bob = await newTenant('ai-usage-bob');
});

afterAll(async () => {
  try {
    for (const tenant of [alice, bob]) {
      if (!tenant) continue;
      await pg.query('delete from public.usage_events where organization_id = $1', [tenant.organizationId]);
      await pg.query('delete from public.organization_plan_assignments where organization_id = $1', [tenant.organizationId]);
      await pg.query('delete from public.organization_feature_activation_overrides where organization_id = $1', [tenant.organizationId]);
      await removePublicSite(tenant.organizationId);
    }
    for (const id of planIds) {
      await pg.query('delete from public.platform_plan_module_grants where plan_id = $1', [id]);
      await pg.query('delete from public.platform_plans where id = $1', [id]);
    }
  } finally {
    await pg.end();
  }
});

describe('the two token meters have one writer, and it is a door over the one ledger', () => {
  it('names public.record_ai_usage as the writer of both, and that function exists', async () => {
    const { rows } = await pg.query(
      `select m.id, m.writer, exists (
                select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'record_ai_usage'
              ) as present
         from public.platform_meters m where m.id in ('ai_tokens_input', 'ai_tokens_output') order by m.id`,
    );
    expect(rows).toEqual([
      { id: 'ai_tokens_input', writer: 'public.record_ai_usage', present: true },
      { id: 'ai_tokens_output', writer: 'public.record_ai_usage', present: true },
    ]);
  });

  it('inserts nothing itself: it calls app.record_usage', async () => {
    const { rows } = await pg.query(
      `select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_ai_usage'`,
    );
    expect(rows[0].prosrc).not.toMatch(/insert\s+into/i);
    expect(rows[0].prosrc.match(/perform\s+app\.record_usage\(/g)).toHaveLength(2);
  });

  it('is executable by the provider operator and by nobody who is signed in or anonymous', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('provider_operator', p.oid, 'execute') as operator,
              has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
              has_function_privilege('anon', p.oid, 'execute') as anonymous
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'record_ai_usage'`,
    );
    expect(rows).toEqual([{ operator: true, signed_in: false, anonymous: false }]);
  });
});

describe('recording what a request consumed', () => {
  async function record(organizationId: string, input: number, output: number, reference: string, capability = 'operator_assistant') {
    await pg.query(
      `select public.record_ai_usage($1, $2, 'anthropic', $3, $4, $5)`,
      [organizationId, capability, input, output, reference],
    );
  }

  async function events(organizationId: string, reference: string) {
    const { rows } = await pg.query(
      `select meter_id, quantity::int as quantity, provider_key, fulfilled_through, note
         from public.usage_events where organization_id = $1 and reference = $2 order by meter_id`,
      [organizationId, reference],
    );
    return rows;
  }

  it('writes the input and the output as their own meters, attributed to the business and the provider', async () => {
    const reference = `req-${randomUUID()}`;
    await asProviderOperator(() => record(alice.organizationId, 1234, 56, reference));
    // The rolled-back transaction above proves nothing was written *by that role's own grant*; the
    // call is repeated below as the owner of the function so the rows survive to be read.
    await record(alice.organizationId, 1234, 56, reference);

    expect(await events(alice.organizationId, reference)).toEqual([
      { meter_id: 'ai_tokens_input', quantity: 1234, provider_key: 'anthropic', fulfilled_through: 'platform_account', note: 'operator_assistant' },
      { meter_id: 'ai_tokens_output', quantity: 56, provider_key: 'anthropic', fulfilled_through: 'platform_account', note: 'operator_assistant' },
    ]);
    expect(await events(bob.organizationId, reference)).toEqual([]);
  });

  it('is the same fact when the same request is reported twice, so a retry never bills twice', async () => {
    const reference = `req-${randomUUID()}`;
    await record(alice.organizationId, 10, 20, reference);
    await record(alice.organizationId, 10, 20, reference);

    expect(await events(alice.organizationId, reference)).toHaveLength(2);
  });

  it('keeps two requests apart even when they consumed the same amount', async () => {
    const first = `req-${randomUUID()}`;
    const second = `req-${randomUUID()}`;
    await record(alice.organizationId, 5, 5, first);
    await record(alice.organizationId, 5, 5, second);

    expect(await events(alice.organizationId, first)).toHaveLength(2);
    expect(await events(alice.organizationId, second)).toHaveLength(2);
  });

  it('writes no event for a meter that consumed nothing, and none at all for a request that consumed nothing', async () => {
    const outputOnly = `req-${randomUUID()}`;
    await record(alice.organizationId, 0, 9, outputOnly);
    expect((await events(alice.organizationId, outputOnly)).map((row) => row.meter_id)).toEqual(['ai_tokens_output']);

    const nothing = `req-${randomUUID()}`;
    await record(alice.organizationId, 0, 0, nothing);
    expect(await events(alice.organizationId, nothing)).toEqual([]);
  });

  it('refuses a capability nobody is assigned, a negative count and a missing reference', async () => {
    await expect(record(alice.organizationId, 1, 1, `req-${randomUUID()}`, 'something_else')).rejects.toMatchObject({ code: '22023' });
    await expect(record(alice.organizationId, -1, 1, `req-${randomUUID()}`)).rejects.toMatchObject({ code: '22023' });
    await expect(record(alice.organizationId, 1, 1, '  ')).rejects.toMatchObject({ code: '22023' });
  });

  it('is a capability the runtime assignment table also knows', async () => {
    const { rows } = await pg.query(`select app.ai_capabilities() as capabilities`);
    expect(rows[0].capabilities).toEqual(['operator_assistant', 'public_assistant', 'configuration_drafting']);
  });
});

describe('whether a business holds a module is decided once, and agrees with the shell', () => {
  async function sql(organizationId: string, moduleKey: string): Promise<boolean> {
    const { rows } = await pg.query('select app.module_entitled($1, $2) as entitled', [organizationId, moduleKey]);
    return rows[0].entitled;
  }

  /** What the shell's own resolver says about the Feature `assistant` is sold as. */
  async function shell(tenant: Tenant): Promise<boolean> {
    const states = await organizationResolvedFeatureStates(tenant.db, { organizationId: tenant.organizationId });
    const ask = states.find((state) => state.featureKey === 'ask_gold');
    return Boolean(ask && ask.entitled && ask.activation === 'active');
  }

  async function signedIn(tenant: Tenant, organizationId: string, moduleKey: string): Promise<boolean> {
    const { data, error } = await tenant.db.rpc('organization_module_entitled', {
      p_organization_id: organizationId,
      p_module_key: moduleKey,
    });
    if (error) throw error;
    return data as boolean;
  }

  async function want(tenant: Tenant) {
    await pg.query(
      `insert into public.organization_modules (organization_id, module_key, enabled_by)
       values ($1, 'assistant', $2) on conflict do nothing`,
      [tenant.organizationId, tenant.userId],
    );
  }

  async function pay(tenant: Tenant, end = '9999-12-31', start = '2020-01-01') {
    await pg.query(
      `insert into public.organization_commercial_terms
         (organization_id, product_key, period_start, period_end, quantity, price_minor, currency, recorded_by, note)
       values ($1, 'module:assistant', $2, $3, 1, 0, null, $4, 'ai-usage.test.ts')`,
      [tenant.organizationId, start, end, tenant.userId],
    );
  }

  it('a business that has not chosen the Agent does not hold it', async () => {
    expect(await sql(alice.organizationId, 'assistant')).toBe(false);
    expect(await shell(alice)).toBe(false);
    expect(await signedIn(alice, alice.organizationId, 'assistant')).toBe(false);
  });

  it('wanted but not paid for is not held', async () => {
    await want(alice);

    expect(await sql(alice.organizationId, 'assistant')).toBe(false);
    expect(await shell(alice)).toBe(false);
  });

  it('wanted and paid for is held, by both resolvers', async () => {
    await pay(alice);

    expect(await sql(alice.organizationId, 'assistant')).toBe(true);
    expect(await shell(alice)).toBe(true);
    expect(await signedIn(alice, alice.organizationId, 'assistant')).toBe(true);
  });

  it('permission is not entitlement: the module is held whatever role the caller has, and the role is checked elsewhere', async () => {
    // `assistant.ask` is `app.has_capability`'s question and is checked by `askQuestion`; nothing
    // in the entitlement function reads a capability.
    const { rows } = await pg.query(
      `select prosrc from pg_proc where pronamespace = 'app'::regnamespace and proname = 'module_entitled'`,
    );
    expect(rows[0].prosrc).not.toMatch(/has_capability|capabilities/);
  });

  it('a business that switched the Feature off has not got it, in either resolver', async () => {
    const { rows } = await pg.query(`select f.id from public.platform_catalog_features f where f.key = 'ask_gold'`);
    await pg.query(
      `insert into public.organization_feature_activation_overrides (organization_id, feature_id, disabled_by)
       values ($1, $2, $3)`,
      [alice.organizationId, rows[0].id, alice.userId],
    );

    expect(await sql(alice.organizationId, 'assistant')).toBe(false);
    expect(await shell(alice)).toBe(false);

    await pg.query('delete from public.organization_feature_activation_overrides where organization_id = $1', [alice.organizationId]);
    expect(await sql(alice.organizationId, 'assistant')).toBe(true);
  });

  it('a lapsed term is not held, in either resolver', async () => {
    await want(bob);
    await pay(bob, '2021-01-01', '2020-01-01');

    expect(await sql(bob.organizationId, 'assistant')).toBe(false);
    expect(await shell(bob)).toBe(false);
  });

  it('a business with a base Plan is entitled by the Plan, not by a legacy term, in either resolver', async () => {
    const plan = await pg.query(
      `insert into public.platform_plans (key, kind, label) values ($1, 'plan', 'ai-usage test plan') returning id`,
      [`ai_usage_${randomUUID().slice(0, 8)}`],
    );
    const planId = plan.rows[0].id as string;
    planIds.push(planId);
    const intelligence = await pg.query(`select id from public.platform_catalog_modules where key = 'intelligence'`);
    await pg.query('insert into public.platform_plan_module_grants (plan_id, module_id) values ($1, $2)', [planId, intelligence.rows[0].id]);
    // Bob's legacy term has lapsed; the Plan is what holds it now.
    await pg.query(
      `insert into public.organization_plan_assignments (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by)
       values ($1, $2, 'plan', '2020-01-01', '9999-12-31', $3)`,
      [bob.organizationId, planId, bob.userId],
    );

    expect(await sql(bob.organizationId, 'assistant')).toBe(true);
    expect(await shell(bob)).toBe(true);
  });

  it('answers no, as for any other business, when the caller is not a member of the one they name', async () => {
    // Alice holds the Agent. Bob asking about Alice's business is told no, the same answer as for
    // a business that has not bought it -- the function cannot be used to learn about another.
    expect(await sql(alice.organizationId, 'assistant')).toBe(true);
    expect(await signedIn(bob, alice.organizationId, 'assistant')).toBe(false);
  });

  it('guided setup, which no Feature maps to, is held on the legacy answer alone', async () => {
    // Founding grants a term and switches `drafting` on, so a founded business holds it.
    expect(await sql(alice.organizationId, 'drafting')).toBe(true);
    expect(await sql(alice.organizationId, 'a_module_nobody_sells')).toBe(false);
  });

  it('is not callable by a signed-in or anonymous role directly', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
              has_function_privilege('anon', p.oid, 'execute') as anonymous
         from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'module_entitled'`,
    );
    expect(rows).toEqual([{ signed_in: false, anonymous: false }]);
  });
});

describe('a public deployment is resolved from its own id', () => {
  it('is executable by the provider operator alone', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('provider_operator', p.oid, 'execute') as operator,
              has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
              has_function_privilege('anon', p.oid, 'execute') as anonymous
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_public_assistant'`,
    );
    expect(rows).toEqual([{ operator: true, signed_in: false, anonymous: false }]);
  });

  it('knows nothing of an id that is not a live deployment', async () => {
    const found = await asProviderOperator(async () => {
      const { rows } = await pg.query('select * from public.resolve_public_assistant($1)', [randomUUID()]);
      return rows;
    });
    expect(found).toEqual([]);
  });

  it('names the business, the instructions its owner wrote and whether it holds the Agent', async () => {
    const created = await publishDeployment(alice, 'Be brief. Never discuss prices.');

    const found = await asProviderOperator(async () => {
      const { rows } = await pg.query('select * from public.resolve_public_assistant($1)', [created.deploymentId]);
      return rows;
    });

    // The business comes from the deployment, never from whoever asked; Alice holds the Agent.
    expect(found).toEqual([
      { organization_id: alice.organizationId, instructions: 'Be brief. Never discuss prices.', entitled: true },
    ]);
  });

  it('says a business without the Agent is not entitled, rather than saying nothing', async () => {
    const carol = await newTenant('ai-usage-carol');
    try {
      const created = await publishDeployment(carol, 'Hello.');

      const found = await asProviderOperator(async () => {
        const { rows } = await pg.query('select entitled from public.resolve_public_assistant($1)', [created.deploymentId]);
        return rows;
      });

      expect(found).toEqual([{ entitled: false }]);
    } finally {
      await removePublicSite(carol.organizationId);
    }
  });

  it('knows nothing of a deployment that is switched off', async () => {
    const created = await publishDeployment(alice, 'Off.', { enabled: false });

    const found = await asProviderOperator(async () => {
      const { rows } = await pg.query('select * from public.resolve_public_assistant($1)', [created.deploymentId]);
      return rows;
    });

    expect(found).toEqual([]);
  });
});

const sites = new Map<string, { siteId: string }>();

/** Everything `publishDeployment` made for one business, in the order its keys allow. */
async function removePublicSite(organizationId: string) {
  await pg.query(`set session_replication_role = replica`);
  try {
    for (const table of ['ai_assistant_deployments', 'ai_assistants', 'public_site_revisions', 'public_sites']) {
      await pg.query(`delete from public.${table} where organization_id = $1`, [organizationId]);
    }
  } finally {
    await pg.query(`set session_replication_role = origin`);
  }
}

/** A live website-chat deployment, built the way the Studio flow leaves one: site, published page, assistant, deployment. */
async function publishDeployment(tenant: Tenant, instructions: string, options: { enabled?: boolean } = {}) {
  const org = tenant.organizationId;
  let site = sites.get(org);
  if (!site) {
    const siteId = randomUUID();
    const revisionId = randomUUID();
    await removePublicSite(org);
    await pg.query(`insert into public.public_sites (organization_id, id, created_by) values ($1, $2, $3)`, [org, siteId, tenant.userId]);
    // What the website vocabulary and its guards accept is `public-site-publishing.test.ts`'s
    // subject. This file only needs a site that counts as published, so the guard is stepped around
    // for this one row rather than the vocabulary being copied here.
    await pg.query(`set session_replication_role = replica`);
    try {
      await pg.query(
        `insert into public.public_site_revisions
           (organization_id, site_id, id, revision_number, status, pages, navigation, created_source, created_by, submitted_at, submitted_by, published_at, published_by)
         values ($1, $2, $3, 1, 'published', '[]'::jsonb, '[]'::jsonb, 'account', $4, now(), $4, now(), $4)`,
        [org, siteId, revisionId, tenant.userId],
      );
      await pg.query('update public.public_sites set current_published_revision_id = $1 where organization_id = $2 and id = $3', [revisionId, org, siteId]);
    } finally {
      await pg.query(`set session_replication_role = origin`);
    }
    site = { siteId };
    sites.set(org, site);
  }

  const assistantId = randomUUID();
  const deploymentId = randomUUID();
  await pg.query(
    `insert into public.ai_assistants (id, organization_id, name, instructions, status, created_by, updated_by)
     values ($1, $2, 'Helper', $3, 'active', $4, $4)`,
    [assistantId, org, instructions, tenant.userId],
  );
  await pg.query(
    `insert into public.ai_assistant_deployments (id, organization_id, assistant_id, surface, public_site_id, enabled)
     values ($1, $2, $3, 'website_chat', $4, $5)`,
    [deploymentId, org, assistantId, site.siteId, options.enabled ?? true],
  );

  return { deploymentId };
}
