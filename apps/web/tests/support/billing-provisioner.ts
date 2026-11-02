import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

/**
 * apps/api's billing provisioner, for database suites that cannot run the Python runtime.
 *
 * `/platform-billing/customer` (`apps/api/app/services/platform_billing/customers.py`, whose own
 * ordering is proved by `test_platform_billing_customer.py`) does three things, and this does the
 * same three against the real database: reserve **as the person** through their own session, ask
 * the processor (here, whatever the suite's own fetch mock answers for `api.stripe.com`), then
 * finalize **as `platform_billing_provisioner`** — the one role that may, entered exactly as
 * PostgREST enters it: `set local role` plus the request's JWT claims. No signing secret is needed
 * or read. What the database refuses here, it refuses to the real runtime too.
 */
export const BILLING_PROVISIONER_ACTOR = '00000000-0000-4000-8000-0000000000b2';
export const BILLING_PROVISIONER_API = 'http://billing-provisioner.test';

type Refusal = { code?: string; message: string };

/** Run one statement as the provisioner, on its own connection so concurrent calls never share a transaction. */
export async function asBillingProvisioner<T>(
  connectionString: string,
  run: (pg: Client) => Promise<T>,
  claims: { sub: string; role: string } = { sub: BILLING_PROVISIONER_ACTOR, role: 'platform_billing_provisioner' },
): Promise<T> {
  const pg = new Client({ connectionString });
  await pg.connect();
  try {
    await pg.query('begin');
    await pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await pg.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'platform_billing_provisioner'}`);
    const result = await run(pg);
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await pg.end();
  }
}

export async function provisionerFinalize(
  connectionString: string,
  input: { organizationId: string; environment: string; pendingReference: string; customerReference: string; requestedBy: string },
  claims?: { sub: string; role: string },
): Promise<{ data: string | null; error: Refusal | null }> {
  try {
    const data = await asBillingProvisioner(connectionString, async (pg) => {
      const { rows } = await pg.query(
        `select public.finalize_platform_billing_customer($1, $2, 'stripe', $3, $4, $5) as reference`,
        [input.organizationId, input.environment, input.pendingReference, input.customerReference, input.requestedBy],
      );
      return rows[0].reference as string;
    }, claims);
    return { data, error: null };
  } catch (error) {
    const { code, message } = error as Refusal;
    return { data: null, error: { code, message } };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A fetch that answers the provisioner's route and passes everything else to `base`. Install it as
 * a suite's `realFetch`, so each test's own Stripe mock still decides what the processor returns.
 */
export function withBillingProvisionerApi(
  base: typeof fetch,
  config: { supabaseUrl: string; anonKey: string; connectionString: string },
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(`${BILLING_PROVISIONER_API}/platform-billing/customer`)) return base(input as never, init);

    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    const token = authorization.replace(/^Bearer /, '');
    const callerId = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}').sub as string | undefined;
    if (!token || !callerId) return json(401, { error: 'unauthorized' });

    const body = JSON.parse(String(init?.body ?? '{}')) as { organization_id?: string; email?: string | null; name?: string | null };
    const organizationId = String(body.organization_id ?? '');
    const environment = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_') ? 'live' : 'sandbox';
    const person = createClient(config.supabaseUrl, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: base },
    });

    const reserve = async () => person
      .rpc('begin_platform_billing_customer', { p_organization_id: organizationId, p_environment: environment, p_provider: 'stripe' })
      .single<{ customer_reference: string; finalized: boolean }>();
    const reserved = await reserve();
    if (reserved.error) {
      return reserved.error.code === '42501' ? json(404, { error: 'not found', code: 'not_found' }) : json(400, { error: 'rejected', code: 'validation' });
    }
    if (reserved.data.finalized) return json(200, { customer_reference: reserved.data.customer_reference, environment });

    const form = new URLSearchParams({ 'metadata[organization_id]': organizationId });
    if (body.email) form.set('email', body.email);
    if (body.name) form.set('name', body.name);
    let created: string | undefined;
    try {
      const answer = await globalThis.fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: { 'Idempotency-Key': `platform-billing-customer:${organizationId}:${reserved.data.customer_reference}` },
        body: form,
      });
      if (answer.ok) created = ((await answer.json()) as { id?: unknown }).id as string | undefined;
    } catch {
      created = undefined;
    }
    if (typeof created !== 'string' || !/^cus_[A-Za-z0-9_]+$/.test(created)) {
      return json(502, { error: 'The billing provider would not create a customer.', code: 'provider_refused' });
    }

    const finalized = await provisionerFinalize(config.connectionString, {
      organizationId, environment, pendingReference: reserved.data.customer_reference, customerReference: created, requestedBy: callerId,
    });
    if (!finalized.error) return json(200, { customer_reference: finalized.data, environment });
    if (finalized.error.code === '23505' || finalized.error.code === '55000') {
      const again = await reserve();
      if (!again.error && again.data.finalized) return json(200, { customer_reference: again.data.customer_reference, environment });
      return json(409, { error: 'conflict', code: 'conflict' });
    }
    return json(finalized.error.code === '42501' ? 404 : 400, { error: 'rejected', code: finalized.error.code === '42501' ? 'not_found' : 'validation' });
  }) as typeof fetch;
}
