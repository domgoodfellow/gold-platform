import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPlan } from '@/lib/domain/catalogue/plans';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { getOrganizationServiceAccess } from '@/lib/domain/platform-billing/service-access';
import {
  requireOrganization,
  requireOrganizationForBillingRecovery,
  serviceLockedHref,
} from '@/lib/route/organization';
import { createCustomerAction } from '@/app/organizations/[organizationId]/customers/actions';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Commercial service access end to end, against real RLS: the guard every page and action runs,
 * the recovery door, and the two facts the policy reads. Stripe is never called — the webhook's
 * own database function is invoked directly, exactly as `platform_billing_webhook` would.
 *
 * `next/navigation` is replaced so `redirect`/`notFound` are observable as thrown values, and
 * `getDb` returns whichever signed-in client the test names; nothing else about the guard is
 * faked.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

let currentDb: SupabaseClient;
vi.mock('@/lib/db/server', () => ({ getDb: async () => currentDb }));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; userId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency: 'CAD',
  });
  return { db, organizationId, userId: created.user.id };
}

let pg: Client;
let staff: SupabaseClient;

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
  // Sandbox: the environment the webhook rows below are written in.
  process.env.STRIPE_SECRET_KEY = 'sk_test_service_access_suite';
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

async function assignPlan(tenant: Tenant, billable: boolean) {
  const planId = await createPlan(staff, {
    key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    kind: 'plan',
    label: 'Service access plan',
    description: '',
    billable,
  });
  await recordPlanAssignment(staff, {
    organizationId: tenant.organizationId,
    planId,
    periodStart: '2000-01-01',
    periodEnd: '9999-12-31',
  });
}

/** The webhook's own door, called as `platform_billing_webhook` calls it. */
async function subscriptionEvent(
  customerReference: string,
  subscriptionReference: string,
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  status: string,
) {
  await pg.query(`select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
    `evt_${randomUUID()}`,
    type,
    customerReference,
    subscriptionReference,
    `price_${randomUUID().slice(0, 8)}`,
    status,
    'CAD',
    null,
    null,
    false,
    null,
    'stripe',
  ]);
}

async function seedCustomerReference(tenant: Tenant): Promise<string> {
  const reference = `cus_${randomUUID().slice(0, 12)}`;
  await pg.query(
    `insert into public.platform_billing_customers (organization_id, environment, customer_reference, created_by)
     values ($1, 'sandbox', $2, $3)`,
    [tenant.organizationId, reference, tenant.userId],
  );
  return reference;
}

async function customerCount(tenant: Tenant): Promise<number> {
  const { count, error } = await tenant.db
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', tenant.organizationId);
  if (error) throw error;
  return count ?? 0;
}

async function asTenant<T>(tenant: Tenant, run: () => Promise<T>): Promise<T> {
  currentDb = tenant.db;
  return run();
}

describe('an organization with a billable Plan', () => {
  it('follows its subscription: locked, serviceable, locked, restored — and loses no data', async () => {
    const tenant = await newTenant('access-billable');
    await createCustomer(tenant.db, { organizationId: tenant.organizationId, name: 'Kept customer' });
    expect(await customerCount(tenant)).toBe(1);

    // No Plan yet: nothing says this organization owes GOLD a subscription.
    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).resolves.toBeTruthy();

    await assignPlan(tenant, true);
    const locked = `REDIRECT:${serviceLockedHref(tenant.organizationId)}`;

    // Missing subscription: the operational guard refuses, the recovery guard admits.
    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).rejects.toThrow(locked);
    const recovery = await asTenant(tenant, () => requireOrganizationForBillingRecovery(tenant.organizationId));
    expect(recovery.access).toMatchObject({ permitted: false, code: 'subscription_missing' });

    const customer = await seedCustomerReference(tenant);
    const subscription = `sub_${randomUUID().slice(0, 12)}`;

    await subscriptionEvent(customer, subscription, 'customer.subscription.created', 'trialing');
    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).resolves.toBeTruthy();

    await subscriptionEvent(customer, subscription, 'customer.subscription.updated', 'active');
    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).resolves.toBeTruthy();

    for (const status of ['past_due', 'unpaid', 'canceled', 'paused', 'incomplete_expired']) {
      await subscriptionEvent(customer, subscription, 'customer.subscription.updated', status);
      await expect(
        asTenant(tenant, () => requireOrganization(tenant.organizationId)),
        status,
      ).rejects.toThrow(locked);
      // The recovery door stays open in every locked state.
      const { access } = await asTenant(tenant, () => requireOrganizationForBillingRecovery(tenant.organizationId));
      expect(access.subscriptionStatus).toBe(status);
      // Locking never deletes or hides the business's data: the row is exactly where it was.
      expect(await customerCount(tenant)).toBe(1);
    }

    // The subscription becomes serviceable again: access returns with no other step.
    await subscriptionEvent(customer, subscription, 'customer.subscription.updated', 'active');
    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).resolves.toBeTruthy();
    expect(await customerCount(tenant)).toBe(1);

    // A deleted subscription is a missing one.
    await subscriptionEvent(customer, subscription, 'customer.subscription.deleted', 'canceled');
    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).rejects.toThrow(locked);
    expect(await customerCount(tenant)).toBe(1);
  }, 60_000);

  it('refuses a server action against a locked organization before it writes', async () => {
    const tenant = await newTenant('access-action');
    await assignPlan(tenant, true);

    const form = new FormData();
    form.set('organizationId', tenant.organizationId);
    form.set('name', 'Should not exist');
    form.set('email', '');
    form.set('phone', '');

    await expect(
      asTenant(tenant, () => createCustomerAction({ error: null, created: false }, form)),
    ).rejects.toThrow(`REDIRECT:${serviceLockedHref(tenant.organizationId)}`);
    expect(await customerCount(tenant)).toBe(0);
  }, 60_000);

  it('does not let a stranger tell a locked organization from a missing one', async () => {
    const locked = await newTenant('access-locked');
    const stranger = await newTenant('access-stranger');
    await assignPlan(locked, true);

    await expect(asTenant(stranger, () => requireOrganization(locked.organizationId))).rejects.toThrow('NOT_FOUND');
    await expect(
      asTenant(stranger, () => requireOrganizationForBillingRecovery(locked.organizationId)),
    ).rejects.toThrow('NOT_FOUND');
    // And the stranger's own business is unaffected by the other's lock.
    await expect(asTenant(stranger, () => requireOrganization(stranger.organizationId))).resolves.toBeTruthy();
  }, 60_000);

  it('is readable by platform staff through the same resolver', async () => {
    const tenant = await newTenant('access-staff');
    await assignPlan(tenant, true);
    const access = await getOrganizationServiceAccess(staff, {
      organizationId: tenant.organizationId,
      environment: 'sandbox',
    });
    expect(access).toMatchObject({ permitted: false, code: 'subscription_missing' });
  }, 60_000);
});

describe('an organization with a non-billable Plan (GOLD Internal is one)', () => {
  it('needs no subscription and is never locked', async () => {
    // A dedicated non-billable Plan rather than the singleton `gold_internal`, which
    // `gold-bootstrap.test.ts` owns; the policy reads `platform_plans.billable`, never the key.
    const tenant = await newTenant('access-internal');
    await assignPlan(tenant, false);

    await expect(asTenant(tenant, () => requireOrganization(tenant.organizationId))).resolves.toBeTruthy();
    const { access } = await asTenant(tenant, () => requireOrganizationForBillingRecovery(tenant.organizationId));
    expect(access).toMatchObject({ permitted: true, code: 'non_billable_plan' });
  }, 60_000);
});
