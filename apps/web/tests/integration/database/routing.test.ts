import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoute, getRoute, listRoutes, updateRoute } from '@/lib/domain/reception/routing';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Routing's own write door: not a SECURITY DEFINER function (this is tenant self-service, the
 * same shape `calls`/`customer_stages` use — `field.manage`-gated RLS, never a staff-only door),
 * but held to the same bar — tenant isolation, and a role without the capability refused by the
 * database rather than a hidden button.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; email: string; userId: string; organizationId: string };

async function account(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { db, email, userId: created.user.id };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, email, userId } = await account(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });
  return { db, email, userId, organizationId };
}

let mine: Tenant;
let other: Tenant;

beforeAll(async () => {
  [mine, other] = await Promise.all([newTenant('routing-a'), newTenant('routing-b')]);
}, 60_000);

const ROUTE_INPUT = {
  numberId: null,
  whenMode: 'always' as const,
  ringStrategy: 'everyone' as const,
  ringTimeoutSeconds: 20,
  destinationType: 'external_number' as const,
  destinationExternalNumber: '+14165550100',
  fallbackType: 'voicemail' as const,
};

describe('a route is one business phone configuration', () => {
  // Each test that creates a route uses its own fresh tenant — `numberId: null` makes every
  // route here the organization's one catch-all, and a shared tenant across tests would collide
  // with itself on `communication_routes_one_default_per_org` (proven directly below).
  it('lets an owner create and read a route back', async () => {
    const tenant = await newTenant('routing-create');
    const routeId = await createRoute(tenant.db, { organizationId: tenant.organizationId, name: 'Main line', ...ROUTE_INPUT });
    const route = await getRoute(tenant.db, { organizationId: tenant.organizationId, routeId });
    expect(route?.name).toBe('Main line');
    expect(route?.destinationExternalNumber).toBe('+14165550100');
  });

  it('reads only its own organization’s routes, whatever organization id the caller names', async () => {
    const routeId = await createRoute(mine.db, { organizationId: mine.organizationId, name: 'Isolated', ...ROUTE_INPUT });

    const crossTenant = await getRoute(other.db, { organizationId: mine.organizationId, routeId });
    expect(crossTenant).toBeNull();

    const list = await listRoutes(other.db, { organizationId: mine.organizationId });
    expect(list.find((route) => route.id === routeId)).toBeUndefined();
  });

  it('refuses a member without field.manage, the same policy that governs configuring calls and stages', async () => {
    const tenant = await newTenant('routing-refuse');
    const { email } = await account('viewer');
    const roleId = await createRole(tenant.db, { organizationId: tenant.organizationId, name: `Viewer ${randomUUID().slice(0, 8)}`, capabilities: [] });
    await addMember(tenant.db, { organizationId: tenant.organizationId, email, displayName: 'No Capabilities', roleId });

    const reader = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    expect(link).toBeTruthy();

    await expect(createRoute(reader, { organizationId: tenant.organizationId, name: 'Should not save', ...ROUTE_INPUT })).rejects.toThrow();
  });

  it('allows at most one organization-wide catch-all route', async () => {
    const tenant = await newTenant('routing-catchall');
    await createRoute(tenant.db, { organizationId: tenant.organizationId, name: 'Catch-all one', ...ROUTE_INPUT, numberId: null });
    await expect(
      createRoute(tenant.db, { organizationId: tenant.organizationId, name: 'Catch-all two', ...ROUTE_INPUT, numberId: null }),
    ).rejects.toThrow();
  });

  it('refuses a route that falls back to itself directly', async () => {
    const tenant = await newTenant('routing-selfloop');
    const routeId = await createRoute(tenant.db, { organizationId: tenant.organizationId, name: 'Self-referencing', ...ROUTE_INPUT });
    await expect(
      updateRoute(tenant.db, { organizationId: tenant.organizationId, routeId, fallbackType: 'route', fallbackRouteId: routeId }),
    ).rejects.toThrow();
  });

  it('never rewrites another organization’s route even when a caller supplies its id', async () => {
    const tenant = await newTenant('routing-hijack');
    const routeId = await createRoute(tenant.db, { organizationId: tenant.organizationId, name: 'Untouched', ...ROUTE_INPUT });

    await updateRoute(other.db, { organizationId: other.organizationId, routeId, name: 'Hijacked' }).catch(() => {});

    const untouched = await getRoute(tenant.db, { organizationId: tenant.organizationId, routeId });
    expect(untouched?.name).toBe('Untouched');
  });
});
