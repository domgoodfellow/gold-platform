import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Agent's lazy-mount lifecycle, in a real browser (Phase C, Slice 12/13). `agent-trigger.test.tsx`
 * proves the mechanism — the registered content never mounts before first open, and survives a
 * close — against a minimal harness; this proves the same lifecycle end to end, through the real
 * shell, the real Server Action (`loadAgentBootstrapAction`) and a real network round trip.
 *
 * Every assertion reads the DOM a person would see — a role, a visible label, text content —
 * never an internal React flag, so a change to *how* the lazy mount is implemented cannot make
 * this pass for the wrong reason.
 */

test.use({ storageState: OWNER_STORAGE_STATE });

test.describe('Agent: closed, open, usable, closed, reopened', () => {
  test('starts closed, opens on demand, becomes usable, and keeps its state across a close and reopen', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);

    const trigger = page.getByRole('button', { name: 'Agent' });
    const panel = page.getByRole('complementary', { name: 'Agent' });

    // Closed: the trigger says so, and nothing the panel would show is in the page at all —
    // this is the lazy-mount contract, not merely a hidden drawer.
    await expect(trigger).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('textbox', { name: 'Message to the Agent' })).toHaveCount(0);

    // Open: the trigger presses, and the panel becomes visible.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();

    // Loading, if it is observable at all, is a transient status region — real network latency
    // may resolve before this assertion runs, so it is checked only when still present rather
    // than required.
    const loading = panel.getByRole('status').filter({ hasText: 'Loading' });
    if (await loading.isVisible().catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 10_000 });
    }

    // Usable: the full conversation grammar is there — composer, History — whether or not a
    // provider is configured. A machine with none left configured (this one, by default: no
    // `ANTHROPIC_API_KEY`) still shows every bit of it; only sending is switched off, which is
    // the deliberate distinction `agent-conversations.test.ts` already holds for the deployment
    // that cannot answer, not something this spec should paper over with a provider-shaped
    // assumption.
    const composer = page.getByRole('textbox', { name: 'Message to the Agent' });
    await expect(composer).toBeVisible();
    await expect(page.getByRole('button', { name: 'History' })).toBeVisible();
    const canAnswer = await composer.isEnabled();

    if (canAnswer) {
      // A draft, typed but never sent, is the state a remount would lose.
      await composer.fill('What is booked today with nobody assigned?');
    }

    // Close: the trigger un-presses and the panel is hidden again.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toBeHidden();

    // Reopen: the same composer — proof the subtree was kept mounted rather than torn down and
    // rebuilt (which a regression to eager-unmount would lose), checked by the one fact that
    // distinguishes "kept" from "rebuilt from the same bootstrap data": an unsent draft, when a
    // provider is configured to make one possible at all.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    if (canAnswer) {
      await expect(composer).toHaveValue('What is booked today with nobody assigned?');
    } else {
      await expect(composer).toBeVisible();
    }
  });
});
