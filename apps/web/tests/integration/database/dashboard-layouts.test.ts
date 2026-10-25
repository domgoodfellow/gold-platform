import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDashboardLayout, resetDashboardLayout, saveDashboardLayout } from '@/lib/domain/preferences/dashboard-layouts';
import { canonicalLayout, defaultLayout, setWidgetOption, stepWidth } from '@/lib/dashboard-layout';
import { FINANCE_WIDGETS } from '@/lib/application/finance/dashboard-widgets';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Personal Dashboard layouts against local PostgreSQL: one row per person, organization and
 * workspace; RLS confines every read and write to one's own rows in organizations one belongs
 * to; a stale revision is refused; invalid layouts never reach the table; reset removes the row.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const registry = FINANCE_WIDGETS;
type Person = { db: SupabaseClient; userId: string; email: string };
let alice: Person, bob: Person, northOrg: string, southOrg: string, bobOrg: string;

async function person(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`, password = `pw-${randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  const db = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { db, userId: made.data.user.id, email };
}
const found = (owner: Person, name: string) => foundBusiness({ ownerEmail: owner.email, name, displayName: 'Owner', timezone: 'America/Toronto', currency: 'CAD' }) as Promise<string>;

beforeAll(async () => {
  [alice, bob] = await Promise.all([person('layout-alice'), person('layout-bob')]);
  northOrg = await found(alice, 'Layout North'); southOrg = await found(alice, 'Layout South'); bobOrg = await found(bob, 'Layout Bob');
  // Sessions refresh their tenant claims after founding.
  for (const p of [alice, bob]) await p.db.auth.refreshSession();
});

describe('a personal Finance layout', () => {
  it('starts as the product default with nothing stored', async () => {
    const stored = await readDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry });
    expect(stored).toEqual({ layout: defaultLayout(registry), revision: 0, customized: false });
  });

  it('saves per organization: changing one organization leaves the other untouched', async () => {
    const wider = canonicalLayout(stepWidth(defaultLayout(registry), registry, 'aging', 1));
    expect(await saveDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry, layout: wider, expectedRevision: 0 })).toBe(1);
    const north = await readDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry });
    expect(north.layout.widgets.find(widget => widget.id === 'aging')!.span).toBe(8);
    expect(north.revision).toBe(1);
    expect((await readDashboardLayout(alice.db, { organizationId: southOrg, workspace: 'finance', registry })).customized).toBe(false);
  });

  it('refuses a save from a stale revision instead of overwriting the newer one', async () => {
    const hidden = canonicalLayout(setWidgetOption(defaultLayout(registry), registry, 'activity', { hidden: true }));
    await expect(saveDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry, layout: hidden, expectedRevision: 0 })).rejects.toMatchObject({ code: 'dashboard_layout.conflict' });
    expect(await saveDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry, layout: hidden, expectedRevision: 1 })).toBe(2);
    await expect(saveDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry, layout: hidden, expectedRevision: 1 })).rejects.toMatchObject({ code: 'dashboard_layout.conflict' });
  });

  it('never stores an invalid layout', async () => {
    const invalid = { ...canonicalLayout(defaultLayout(registry)), widgets: [...canonicalLayout(defaultLayout(registry)).widgets, { id: 'saved-report:anything', span: 6, height: 'standard' }] };
    await expect(saveDashboardLayout(alice.db, { organizationId: southOrg, workspace: 'finance', registry, layout: invalid, expectedRevision: 0 })).rejects.toMatchObject({ code: 'dashboard_layout.invalid' });
    // The table refuses a shape outside its bounds even if the application check were skipped.
    const { error } = await alice.db.from('dashboard_layout_preferences').insert({ user_id: alice.userId, organization_id: southOrg, workspace: 'finance', layout: { version: 2, widgets: [] } });
    expect(error?.code).toBe('23514');
  });

  it('resets by removing the override', async () => {
    await resetDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance' });
    expect(await readDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry })).toMatchObject({ revision: 0, customized: false });
  });
});

describe('who may read or write a layout', () => {
  it('shows nobody else a person’s layout', async () => {
    await saveDashboardLayout(alice.db, { organizationId: northOrg, workspace: 'finance', registry, layout: canonicalLayout(defaultLayout(registry)), expectedRevision: 0 });
    const { data } = await bob.db.from('dashboard_layout_preferences').select('user_id').eq('user_id', alice.userId);
    expect(data).toEqual([]);
  });

  it('refuses writing a row for someone else, or for an organization one does not belong to', async () => {
    const layout = canonicalLayout(defaultLayout(registry));
    const forAlice = await bob.db.from('dashboard_layout_preferences').insert({ user_id: alice.userId, organization_id: bobOrg, workspace: 'finance', layout });
    expect(forAlice.error?.code).toBe('42501');
    const otherOrg = await bob.db.from('dashboard_layout_preferences').insert({ user_id: bob.userId, organization_id: northOrg, workspace: 'finance', layout });
    expect(otherOrg.error?.code).toBe('42501');
    await expect(saveDashboardLayout(bob.db, { organizationId: northOrg, workspace: 'finance', registry, layout, expectedRevision: 0 })).rejects.toMatchObject({ code: 'dashboard_layout.forbidden' });
    const update = await bob.db.from('dashboard_layout_preferences').update({ revision: 99 }).eq('user_id', alice.userId).select('revision');
    expect(update.data).toEqual([]);
  });

  it('refuses an unsupported workspace key', async () => {
    const { error } = await bob.db.from('dashboard_layout_preferences').insert({ user_id: bob.userId, organization_id: bobOrg, workspace: 'platform', layout: canonicalLayout(defaultLayout(registry)) });
    expect(error?.code).toBe('23514');
  });
});
