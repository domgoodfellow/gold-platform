import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { resolveOrganizationsLanding } from '@/lib/route/landing';
import { foundBusiness } from './helpers/founding';

/**
 * D45's routing claim end to end: platform authority and organization membership are two
 * independent facts about one identity, read together rather than either being hidden by the
 * other. `landing.test.ts` proves `resolveOrganizationsLanding` itself against every combination,
 * pure; this suite proves the two facts it is fed — `isPlatformStaff` and `listMyOrganizations` —
 * actually combine that way against real RLS, for identities built the way the product builds
 * them (`provisionOrganization`, `addMember`), not by hand.
 *
 * The locked product decision: platform staff default into Platform Administration regardless of
 * how many businesses they also belong to. Membership itself is untouched by this — `mixed one`
 * and `mixed multi` below both prove their real membership rows still exist and are still read —
 * only the *default landing* changed. `?all=1` (not exercised against real identities here;
 * `landing.test.ts` covers it purely) is the explicit override that shows the chooser instead.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function newUser(label: string): Promise<{ email: string; password: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { email, password, userId: created.user.id };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

async function signedInUser(label: string): Promise<{ db: SupabaseClient; email: string }> {
  const { email, password } = await newUser(label);
  return { db: await signIn(email, password), email };
}

/** Staff written the way `add-platform-staff.sql` writes it — no application path ever may. */
async function signedInStaff(label: string): Promise<{ db: SupabaseClient; email: string }> {
  const { email, password, userId } = await newUser(label);

  const pg = new Client(CONNECTION);
  await pg.connect();
  await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
    userId,
    label,
  ]);
  await pg.end();

  return { db: await signIn(email, password), email };
}

let tenantOnly: { db: SupabaseClient; email: string };
let platformOnly: { db: SupabaseClient; email: string };
let mixedOne: { db: SupabaseClient; email: string };
let mixedMulti: { db: SupabaseClient; email: string };
let mixedOneOrgId: string;

describe('who lands where, once platform authority and organization membership are read independently (D45)', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    tenantOnly = await signedInUser('ctx-tenant');
    await foundBusiness({
      ownerEmail: tenantOnly.email,
      name: `Tenant Only ${randomUUID().slice(0, 6)}`,
      currency: 'EUR',
      displayName: 'Owner',
    });

    platformOnly = await signedInStaff('ctx-platform-only');

    // A business somebody else owns, that the mixed identities are added to as ordinary
    // members — proving the membership is a real row under `add_member_by_email`, not a
    // fixture shortcut, exactly as `platform-staff.test.ts`'s "dual-hat" case does.
    const owner = await signedInUser('ctx-owner');
    const orgOne = await foundBusiness({
      ownerEmail: owner.email,
      name: `Mixed One ${randomUUID().slice(0, 6)}`,
      currency: 'EUR',
      displayName: 'Owner',
    });
    const [foundingRoleOne] = await listRoles(owner.db, { organizationId: orgOne });
    mixedOneOrgId = orgOne;

    mixedOne = await signedInStaff('ctx-mixed-one');
    await addMember(owner.db, {
      organizationId: orgOne,
      email: mixedOne.email,
      displayName: 'Mixed One',
      roleId: foundingRoleOne.id,
    });

    const ownerB = await signedInUser('ctx-owner-b');
    const orgTwo = await foundBusiness({
      ownerEmail: ownerB.email,
      name: `Mixed Multi A ${randomUUID().slice(0, 6)}`,
      currency: 'EUR',
      displayName: 'Owner',
    });
    const [foundingRoleTwo] = await listRoles(ownerB.db, { organizationId: orgTwo });
    const orgThree = await foundBusiness({
      ownerEmail: ownerB.email,
      name: `Mixed Multi B ${randomUUID().slice(0, 6)}`,
      currency: 'EUR',
      displayName: 'Owner',
    });
    const [foundingRoleThree] = await listRoles(ownerB.db, { organizationId: orgThree });

    mixedMulti = await signedInStaff('ctx-mixed-multi');
    await addMember(ownerB.db, {
      organizationId: orgTwo,
      email: mixedMulti.email,
      displayName: 'Mixed Multi',
      roleId: foundingRoleTwo.id,
    });
    await addMember(ownerB.db, {
      organizationId: orgThree,
      email: mixedMulti.email,
      displayName: 'Mixed Multi',
      roleId: foundingRoleThree.id,
    });
  });

  it('tenant-only, one organization → enters it', async () => {
    expect(await isPlatformStaff(tenantOnly.db)).toBe(false);
    const organizations = await listMyOrganizations(tenantOnly.db);
    expect(organizations).toHaveLength(1);

    const landing = resolveOrganizationsLanding({
      organizations,
      staff: false,
      showAll: false,
    });
    expect(landing.kind).toBe('enter');
  });

  it('platform-only, zero organizations → /platform', async () => {
    expect(await isPlatformStaff(platformOnly.db)).toBe(true);
    const organizations = await listMyOrganizations(platformOnly.db);
    expect(organizations).toHaveLength(0);

    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: false })).toEqual({
      kind: 'platform',
    });
  });

  it('mixed platform + tenant, one organization → /platform by default, membership untouched', async () => {
    expect(await isPlatformStaff(mixedOne.db)).toBe(true);
    const organizations = await listMyOrganizations(mixedOne.db);
    // The membership itself is real and still read — this identity is not blocked from the
    // business, only no longer auto-entered into it by default.
    expect(organizations).toHaveLength(1);
    expect(organizations[0].id).toBe(mixedOneOrgId);

    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: false })).toEqual({
      kind: 'platform',
    });
    // The explicit override still reaches the same real membership.
    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: true })).toEqual({
      kind: 'chooser',
    });
  });

  it('mixed, multiple organizations → /platform by default, chooser on explicit request', async () => {
    expect(await isPlatformStaff(mixedMulti.db)).toBe(true);
    const organizations = await listMyOrganizations(mixedMulti.db);
    expect(organizations).toHaveLength(2);

    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: false })).toEqual({
      kind: 'platform',
    });
    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: true })).toEqual({
      kind: 'chooser',
    });
  });

  it('a tenant-only identity is refused platform authority, live', async () => {
    // What makes `/platform`'s own guard (below) honest rather than decorative: the fact it
    // reads is real and reads false for a real tenant-only account.
    expect(await isPlatformStaff(tenantOnly.db)).toBe(false);
  });
});

/**
 * The regression itself, as a source guard: `organizations/page.tsx` must decide through the one
 * pure function every combination above is checked against, not through its own inline
 * `isPlatformStaff` short-circuit again — which is exactly how a caller with platform authority
 * and a real organization stopped being able to reach it. And `/platform`'s own layout must keep
 * refusing a non-staff caller outright, since that is the other half of the loop that must not
 * reopen.
 */
describe('the routing decision stays where it can be tested', () => {
  const organizationsPage = readFileSync(
    fileURLToPath(new URL('../app/organizations/page.tsx', import.meta.url)),
    'utf8',
  );
  const platformLayout = readFileSync(
    fileURLToPath(new URL('../app/(platform)/platform/layout.tsx', import.meta.url)),
    'utf8',
  );

  it('/organizations decides through resolveOrganizationsLanding', () => {
    expect(organizationsPage).toContain('resolveOrganizationsLanding');
  });

  it('/organizations no longer redirects to /platform before organizations are read', () => {
    // The exact shape of the regression: `isPlatformStaff` used as the sole condition, ahead of
    // `listMyOrganizations`, sending every staff member away regardless of membership.
    expect(organizationsPage).not.toMatch(/if\s*\(\s*await isPlatformStaff\(db\)\s*\)\s*\{\s*redirect\('\/platform'\)/);
  });

  it('/platform still refuses a caller with no platform authority', () => {
    expect(platformLayout).toMatch(/if\s*\(!\(await isPlatformStaff\(db\)\)\)\s*redirect\('\/organizations'\)/);
  });
});

/**
 * The routing defect this suite exists to prevent from coming back: a business-entry link built
 * by hand (`/organizations/${id}`, or `/organizations/${id}/today` with the first Area's segment
 * spelled out again) rather than through `organizationHomeHref`, the one place that fact lives
 * (`lib/navigation.ts`). A hand-built link agrees with the real first Area today and silently
 * stops agreeing the day `AREAS[0]` changes — which is exactly the shape of bug that sent a
 * member into a route with no page behind it.
 */
describe('business-entry links go through organizationHomeHref, not a hand-built URL', () => {
  const contextSwitcher = readFileSync(
    fileURLToPath(new URL('../components/containers/context-switcher.tsx', import.meta.url)),
    'utf8',
  );
  const organizationsPage = readFileSync(
    fileURLToPath(new URL('../app/organizations/page.tsx', import.meta.url)),
    'utf8',
  );
  const organizationRootPage = readFileSync(
    fileURLToPath(new URL('../app/organizations/[organizationId]/page.tsx', import.meta.url)),
    'utf8',
  );

  it('ContextSwitcher builds its business-entry link through organizationHomeHref', () => {
    expect(contextSwitcher).toContain('organizationHomeHref(');
    expect(contextSwitcher).not.toMatch(/href=\{`\/organizations\/\$\{organization\.id\}/);
  });

  it('/organizations enters a business through organizationHomeHref', () => {
    expect(organizationsPage).toContain('organizationHomeHref(');
  });

  it('/organizations/[organizationId] is a real doorway — guarded, then redirected to organizationHomeHref', () => {
    // The same guard every area page calls, not a layout trusted for authorization (I12) and not
    // a second permission model: a non-member reaches this route's own `not-found.tsx`, exactly
    // as any other page under `[organizationId]` does.
    expect(organizationRootPage).toContain('requireOrganization(');
    expect(organizationRootPage).toContain('organizationHomeHref(');
  });
});

/**
 * The refusal a non-member actually reaches — proven live by browser QA (a `not-found.tsx`
 * colocated with a layout cannot catch that same layout's own `notFound()`; only an ancestor
 * segment's `not-found.tsx` can, per Next's component hierarchy), and pinned here as a source
 * guard so the boundary that makes it true cannot go missing silently. `[organizationId]/layout.tsx`
 * calls `requireOrganization` itself (to render the shell), so a non-member's `notFound()` is
 * thrown by the layout before any page beneath it runs — `app/organizations/not-found.tsx` is
 * the file that actually renders for that, not `[organizationId]/not-found.tsx`.
 */
describe('the tenant-safe refusal survives being thrown by the layout, not a page', () => {
  const organizationsNotFound = readFileSync(
    fileURLToPath(new URL('../app/organizations/not-found.tsx', import.meta.url)),
    'utf8',
  );
  const organizationIdNotFound = readFileSync(
    fileURLToPath(new URL('../app/organizations/[organizationId]/not-found.tsx', import.meta.url)),
    'utf8',
  );
  const layout = readFileSync(
    fileURLToPath(new URL('../app/organizations/[organizationId]/layout.tsx', import.meta.url)),
    'utf8',
  );

  it('app/organizations/not-found.tsx exists and renders the shared tenant-safe copy', () => {
    expect(organizationsNotFound).toContain('OrganizationNotFound');
  });

  it('[organizationId]/not-found.tsx renders the same shared copy, for a page-level notFound()', () => {
    expect(organizationIdNotFound).toContain('OrganizationNotFound');
  });

  it('the layout still calls requireOrganization itself, which is exactly what makes the ancestor boundary necessary', () => {
    expect(layout).toContain('requireOrganization(');
  });
});
