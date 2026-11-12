import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { organizationResolvedFeatureStates } from '../lib/domain/catalogue/organization-plans';
import { featureOperationalState } from '../lib/domain/catalogue/feature-operational-state';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';

/**
 * Feature-level navigation gating: Settings -> Features shows canonical Feature
 * entitlement/activation/readiness (`organizationResolvedFeatureStates`), and the operator
 * shell's sidebar/phone bar now gate a feature-specific area on that same resolved state
 * (`Area.featureKeys`) rather than the coarser legacy module key. This spec drives the real
 * browser through both halves of that closure and through the role-capability layer beside it,
 * rather than only asserting the predicate in isolation (that proof is `navigation.test.ts`).
 *
 * Uses the demo's own default entitlement shape (`pnpm demo`/`demo:fresh`) rather than inventing
 * new fixtures: Grachtwerk Verhuur is wanted-and-paid for `billing`, `reporting`, `assets` and
 * `drafting`, so `assets` (a single-Feature area) is the natural feature to disable/re-enable
 * here, and its colleague `joris@grachtwerk.test` already holds a reduced role
 * (`Werfmedewerker`, no `report.read`) for the capability-gating half.
 */

test.describe('Settings > Features and the shell agree, and a disable removes exactly one area', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('shows canonical entitlement/activation/readiness for entitled Features', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/features`);

    await expect(page.getByRole('heading', { name: 'Features', level: 1 })).toBeVisible();

    // Entitled, usable Features carry their operational status in their product group.
    await expect(page.getByText('On', { exact: true }).first()).toBeVisible();

    // The ordinary demo has excluded features; the disposable all-products plan has none.
    // Compare the rendered count with this business's actual entitlement in either harness.
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await db.auth.signInWithPassword({ email: context.ownerEmail, password: DEMO_PASSWORD });
    if (login.error) throw login.error;
    const notIncluded = (await organizationResolvedFeatureStates(db, { organizationId: context.organizationId })).filter((state) => featureOperationalState(state) === 'not_included').length;
    if (notIncluded > 0) {
      await expect(page.getByText(`${notIncluded === 1 ? '1 more feature is' : `${notIncluded} more features are`} available on other plans.`, { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText(/available on other plans\.$/)).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'View plan & usage' })).toHaveCount(notIncluded > 0 ? 1 : 0);
    await expect(page.getByText(/Not in your plan|Limited availability/)).toHaveCount(0);
  });

  test('disabling the Assets Feature removes Assets from both the sidebar and the phone bar, and restores on re-enable', async ({ page }) => {
    const context = loadDemoContext();
    const orgHref = `/organizations/${context.organizationId}`;

    // Before: Assets is a real, navigable destination of the Work workspace (desktop sidebar and
    // phone bar both render the same `visibleAreas` list — see navigation.test.ts's parity proof).
    await page.goto(`${orgHref}/field`);
    await expect(page.getByRole('link', { name: 'Equipment & Assets', exact: true }).first()).toBeVisible();

    await page.goto(`${orgHref}/settings/features`);
    await page.getByRole('button', { name: 'More actions for Assets' }).click();
    await page.getByRole('menuitem', { name: 'Disable feature' }).click();
    await expect(page.getByRole('heading', { name: 'Disable Assets?' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Disable feature' }).click();
    await expect(page.getByRole('heading', { name: 'Disable Assets?' })).not.toBeVisible();

    // The row itself says so. The server action revalidates the whole organization layout, which
    // can take a moment the first time this route recompiles in dev — worth a generous timeout
    // rather than a flaky race.
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible({ timeout: 15_000 });

    // The area is gone from navigation entirely — not merely relabelled.
    await page.goto(`${orgHref}/field`);
    await expect(page.getByRole('link', { name: 'Equipment & Assets', exact: true })).toHaveCount(0);

    // What it already recorded is untouched and still directly reachable — disabling a Feature
    // hides the door, not what is behind it. The page's own PageHeader is the one level-1 heading.
    await page.goto(`${orgHref}/assets`);
    await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
    await expect(page.getByText('E2E Test Compressor').first()).toBeVisible();

    // Re-enable restores the area.
    await page.goto(`${orgHref}/settings/features`);
    await page.getByRole('button', { name: 'More actions for Assets' }).click();
    await page.getByRole('menuitem', { name: 'Enable feature' }).click();
    // Wait for the server action to land before leaving the page, or navigating away cancels it.
    await expect(page.getByText('Disabled', { exact: true })).toHaveCount(0, { timeout: 15_000 });

    await page.goto(`${orgHref}/field`);
    await expect(page.getByRole('link', { name: 'Equipment & Assets', exact: true }).first()).toBeVisible();
  });

  test('Plan & usage no longer duplicates the activation control Features owns', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/plan`);

    await expect(page.getByRole('heading', { name: 'Plan & usage', level: 1 })).toBeVisible();
    // The one control for switching a Feature off lives on Features; this screen only links
    // there, rather than repeating a second Disable/Enable affordance beside its own listing.
    await expect(page.getByRole('link', { name: 'Manage features', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /More actions for/ })).toHaveCount(0);
  });

  test("grants report.read to the colleague's role, then removes it again", async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/access/roles`);
    await page.getByRole('link', { name: 'Werfmedewerker', exact: true }).click();
    await page.getByLabel('See what this business has billed and what its work cost').check();
    await page.getByRole('button', { name: 'Save role' }).click();
    // The role's page confirms the save; the colleague spec after this one, seeing Reports appear,
    // is what proves it reached the database rather than merely not throwing client-side.
    await expect(page.getByText('Role saved')).toBeVisible();
  });
});

test.describe('a colleague sees Insights only while their role holds a relevant capability', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees the Insights panel on Work once the owner granted report.read', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/work`);
    await expect(page.getByRole('button', { name: 'Insights', exact: true })).toBeVisible();
  });
});

test.describe('the owner revokes report.read again', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('removes report.read from Werfmedewerker', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/access/roles`);
    await page.getByRole('link', { name: 'Werfmedewerker', exact: true }).click();
    await page.getByLabel('See what this business has billed and what its work cost').uncheck();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Role saved')).toBeVisible();
  });
});

test.describe('the colleague loses Insights again once the capability is gone', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('no longer sees the Insights panel', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/work`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Insights', exact: true })).toHaveCount(0);
  });
});
