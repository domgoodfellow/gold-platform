import { test, expect } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';

/**
 * The M17 navigation-closure slice: Settings -> Features shows canonical Feature
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

    // Reporting's entitled Features read "Included" with a readiness word, never "Not included".
    await expect(page.getByText('Included · Ready').first()).toBeVisible();

    // A Feature nobody has wanted-and-paid for (card payments isn't part of this business's
    // default shape) reads honestly as not included, with a way to the Plan screen rather than a
    // disable control it cannot use.
    await expect(page.getByText('Not included in your plan').first()).toBeVisible();
  });

  test('disabling the Assets Feature removes Assets from both the sidebar and the phone bar, and restores on re-enable', async ({ page }) => {
    const context = loadDemoContext();
    const orgHref = `/organizations/${context.organizationId}`;

    // Before: Assets is a real, navigable area (desktop sidebar and phone bar both render the
    // same `visibleAreas` list — see navigation.test.ts's parity proof for the pure predicate).
    await page.goto(`${orgHref}/home`);
    await expect(page.getByRole('link', { name: 'Assets', exact: true }).first()).toBeVisible();

    await page.goto(`${orgHref}/settings/features`);
    await page.getByRole('button', { name: 'More actions for Assets' }).click();
    await page.getByRole('menuitem', { name: 'Disable feature' }).click();
    await expect(page.getByRole('heading', { name: 'Disable Assets?' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Disable feature' }).click();
    await expect(page.getByRole('heading', { name: 'Disable Assets?' })).not.toBeVisible();

    // The row itself says so. The server action revalidates the whole organization layout, which
    // can take a moment the first time this route recompiles in dev — worth a generous timeout
    // rather than a flaky race.
    await expect(page.getByText('disabled', { exact: true })).toBeVisible({ timeout: 15_000 });

    // The area is gone from navigation entirely — not merely relabelled.
    await page.goto(`${orgHref}/home`);
    await expect(page.getByRole('link', { name: 'Assets', exact: true })).toHaveCount(0);

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
    await expect(page.getByText('disabled', { exact: true })).toHaveCount(0, { timeout: 15_000 });

    await page.goto(`${orgHref}/home`);
    await expect(page.getByRole('link', { name: 'Assets', exact: true }).first()).toBeVisible();
  });

  test('Plan & usage no longer duplicates the activation control Features owns', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/settings/plan`);

    await expect(page.getByRole('heading', { name: 'Plan & usage', level: 1 })).toBeVisible();
    // The one control for switching a Feature off lives on Features; this screen only links
    // there, rather than repeating a second Disable/Enable affordance beside its own listing.
    await expect(page.getByRole('link', { name: 'Manage features →' })).toBeVisible();
    await expect(page.getByRole('button', { name: /More actions for/ })).toHaveCount(0);
  });

  test("grants report.read to the colleague's role, then removes it again", async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/roles`);
    await page.getByRole('tab', { name: 'Roles & permissions' }).click();

    await page.getByRole('button', { name: 'Edit Werfmedewerker' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Werfmedewerker' })).toBeVisible();
    await page.getByLabel('See what this business has billed and what its work cost').check();
    await page.getByRole('button', { name: 'Save role' }).click();
    // The sheet stays open on success (it is not a wizard the save dismisses) — waiting for the
    // pending label to clear is what proves the round trip finished; the colleague spec after
    // this one, seeing Reports appear, is what proves it actually reached the database rather
    // than merely not throwing client-side.
    await expect(page.getByRole('button', { name: 'Save role' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

test.describe('a colleague sees Insights only while their role holds a relevant capability', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees Insights once the owner granted report.read', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/home`);
    await expect(page.getByRole('link', { name: 'Insights', exact: true }).first()).toBeVisible();
  });
});

test.describe('the owner revokes report.read again', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('removes report.read from Werfmedewerker', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/roles`);
    await page.getByRole('tab', { name: 'Roles & permissions' }).click();

    await page.getByRole('button', { name: 'Edit Werfmedewerker' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Werfmedewerker' })).toBeVisible();
    await page.getByLabel('See what this business has billed and what its work cost').uncheck();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByRole('button', { name: 'Save role' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

test.describe('the colleague loses Insights again once the capability is gone', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('no longer sees Insights', async ({ page }) => {
    const context = loadDemoContext();
    await page.goto(`/organizations/${context.organizationId}/home`);
    await expect(page.getByRole('link', { name: 'Insights', exact: true })).toHaveCount(0);
  });
});
