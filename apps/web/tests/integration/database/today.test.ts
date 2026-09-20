import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { createCustomer } from '@/lib/domain/customers/customers';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { listRecentActivity } from '@/lib/domain/timeline/timeline';

/**
 * Today as the operational cockpit (product reality audit, Slice 2).
 *
 * **Structural claims are a source scan, for the reason `layout.test.ts` gives for the same
 * choice**: an async server component has no rendering harness this repository runs, so which
 * widgets exist in which order under which lifecycle state is read from the file rather than
 * mounted. **Data claims — tenant isolation, real attribution, zero-is-valid — are real Postgres
 * tests**, because those are exactly the two kinds of mistake a source scan cannot catch.
 */

const TODAY = fileURLToPath(
  new URL('../../../app/organizations/[organizationId]/today/page.tsx', import.meta.url),
);
const TODAY_FEATURE = fileURLToPath(new URL('../../../features/today/today-dashboard.tsx', import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function signedInStranger(): Promise<SupabaseClient> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `stranger-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return db;
}

async function freshOrganization(): Promise<{ db: SupabaseClient; organizationId: string }> {
  const db = await signedInStranger();
  const organizationId = await createOrganization(db, {
    name: `Today Test ${randomUUID().slice(0, 6)}`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });
  return { db, organizationId };
}

describe('Today, with nothing configured yet', () => {
  it('names the empty state and links to Work rather than showing two silent zeroes', () => {
    const source = `${readFileSync(TODAY, 'utf8')}\n${readFileSync(TODAY_FEATURE, 'utf8')}`;

    expect(source).toContain('listWorkItemTypes');
    expect(source).toContain('typesConfigured={types.length > 0}');
    expect(source).toMatch(/!typesConfigured[\s\S]{0,300}organizations\/\$\{organizationId\}\/work\/configuration/);
  });
});

describe('Today, structural composition (source scan)', () => {
  const source = `${readFileSync(TODAY, 'utf8')}\n${readFileSync(TODAY_FEATURE, 'utf8')}`;

  it('reads readiness from the existing mechanism rather than a second calculation', () => {
    expect(source).toContain("import { computeReadiness } from '@/lib/domain/tenancy/lifecycle'");
    expect(source).toContain('computeReadiness(db, { organizationId })');
  });

  it('shows one restrained setup notice in SETUP and never the full Setup dashboard', () => {
    // Today is the operating cockpit. The readiness checklist, its blocker/warning lists and the
    // launch controls live on Setup — here there is a sentence, a count and a way back.
    expect(source).not.toContain('readinessWidget');
    expect(source).not.toMatch(/Setup readiness/);
    expect(source).not.toMatch(/LaunchForm|Blocker'|Warning'/);
    expect(source).toContain('This business is still being set up.');
    expect(source).toContain('Continue setup');

    // Rendered once, gated on the lifecycle state, and the widget grid is the same in both states.
    expect(source.match(/\{setupNotice\}/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/const setupNotice = inSetup \?/);
    expect(source).toContain('<WidgetGrid>{operations}{activityWidget}</WidgetGrid>');
  });

  it('never claims a business with zero blockers is complete or launched', () => {
    expect(source).not.toMatch(/Setup complete/i);
    expect(source).not.toMatch(/setup is (complete|finished|done)/i);
  });

  it('preserves the existing Committed/Waiting queries unchanged', () => {
    expect(source).toContain("import { listSchedule } from '@/lib/domain/scheduling/availability'");
    expect(source).toContain("import { listWorkItems } from '@/lib/domain/work-items/work-items'");
    expect(source).toContain('listSchedule(db, {');
  });

  it('gates the new operational widgets on the module being enabled, never on their current count', () => {
    expect(source).toMatch(/automationsOn \? \[/);
    expect(source).toMatch(/receptionOn \? <Widget/);
    // The tell for a count-based gate would be `failedRuns.length > 0 ?` guarding the whole
    // widget rather than only its `href`/empty-state — asserted absent.
    expect(source).not.toMatch(/failedRuns\.length > 0 \?\s*\(?\s*<Widget/);
    expect(source).not.toMatch(/failedMessages\.length > 0 \?\s*\(?\s*<Widget/);
  });

  it('counts only today’s calls when naming calls that still need a write-up', () => {
    expect(source).toContain(
      'unwrittenCalls={todaysCalls.filter((call) => call.outcome === null).length}',
    );
  });

  it('expands Committed, Waiting and Recent activity through the existing ?widget= mechanism', () => {
    expect(source).toContain(
      "open === 'committed' || open === 'waiting' || open === 'activity'",
    );
    expect(source).toContain('${area}?widget=activity');
    expect(source).toContain('${area}?widget=committed');
    expect(source).toContain('${area}?widget=waiting');
  });
});

describe('Today, real data behind the new widgets', () => {
  it('recent activity is tenant-isolated and renders a real, attributable event', async () => {
    const { db: dbA, organizationId: orgA } = await freshOrganization();
    const { organizationId: orgB } = await freshOrganization();

    await createCustomer(dbA, { organizationId: orgA, name: 'Ana Reyes' });

    const ownActivity = await listRecentActivity(dbA, { organizationId: orgA });
    const customerCreated = ownActivity.find((entry) => entry.description === 'Added as a customer');
    expect(customerCreated).toBeDefined();
    expect(customerCreated?.actorName).toBe('Founder');

    // The organization itself coming into existence is on the same feed, in the platform's own
    // words rather than the raw action string.
    expect(ownActivity.some((entry) => entry.description === 'This business was created')).toBe(
      true,
    );

    // Asking A's own session about B's organization returns nothing — RLS scopes by the
    // caller's membership regardless of which id the query names.
    const crossTenant = await listRecentActivity(dbA, { organizationId: orgB });
    expect(crossTenant).toEqual([]);
  });

  it('a stranger with no membership gains nothing through any of Today’s reused readers', async () => {
    const { db, organizationId } = await freshOrganization();
    // Real data behind the readers, so "the stranger sees nothing" is a claim about RLS rather
    // than a claim about there being nothing to see.
    await createCustomer(db, { organizationId, name: 'A Real Customer' });
    await setModuleEnabled(db, { organizationId, key: 'automations', enabled: true });

    const stranger = await signedInStranger();

    expect(await listRecentActivity(stranger, { organizationId })).toEqual([]);
    expect(
      await listAutomationRuns(stranger, { organizationId, failedOnly: true }),
    ).toEqual([]);
    expect(
      await listMessageDeliveries(stranger, { organizationId, failedOnly: true }),
    ).toEqual([]);
  });

  it('a module switched on with zero failures is a valid, distinct state from the module being off', async () => {
    const { db, organizationId } = await freshOrganization();

    // Off: nothing to ask, and the page itself never calls these readers in that state
    // (asserted by the source scan above). On: a real, empty answer — not an error, not
    // undefined, and not indistinguishable from "the module isn't there".
    await setModuleEnabled(db, { organizationId, key: 'automations', enabled: true });

    const runs = await listAutomationRuns(db, { organizationId, failedOnly: true });
    const messages = await listMessageDeliveries(db, { organizationId, failedOnly: true });

    expect(runs).toEqual([]);
    expect(messages).toEqual([]);
  });
});
