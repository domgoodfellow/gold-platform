import { expect, type Locator, type Page } from '@playwright/test';

/**
 * A screenshot is evidence only of the page it was meant to show. Before any capture this checks
 * that the browser is signed in, at the expected address, past loading, showing the expected
 * content, and not showing a sign-in, not-found, unauthorized or error page instead. Any failure
 * throws, so a run never saves a picture of the wrong screen as if it were the right one.
 */
export type Capture = { url: string | RegExp; content: Locator };

const SIGN_IN = /^\/(login|sign-up|forgot-password|reset-password|verify-email|auth)(\/|$)/;
// A refused organization or platform page renders not-found, so not-found also covers unauthorized.
const REFUSALS = ['This page does not exist.', 'Something went wrong'] as const;

export async function assertCapturable(page: Page, { url, content }: Capture): Promise<void> {
  await page.waitForLoadState('networkidle');
  const at = new URL(page.url());
  if (SIGN_IN.test(at.pathname)) throw new Error(`Refusing to capture: the browser is signed out (at ${at.pathname}).`);
  if (await page.getByRole('heading', { name: 'Log in', exact: true }).count()) throw new Error(`Refusing to capture: a sign-in form is showing at ${at.pathname}.`);
  const where = `${at.pathname}${at.search}${at.hash}`;
  if (typeof url === 'string' ? where !== url && at.pathname !== url : !url.test(where)) throw new Error(`Refusing to capture: expected ${url}, but the browser is at ${where}.`);
  for (const text of REFUSALS) {
    if (await page.getByText(text, { exact: false }).filter({ visible: true }).count()) throw new Error(`Refusing to capture: "${text}" is showing at ${where}.`);
  }
  await expect(content, `expected content at ${where}`).toBeVisible();
  // Loading has resolved: no visible skeleton or busy region is left.
  await expect(page.locator('[aria-busy="true"]:visible, [data-slot="skeleton"]:visible')).toHaveCount(0);
}

/** Capture only after `assertCapturable` passes. */
export async function guardedShot(page: Page, capture: Capture, options: Parameters<Page['screenshot']>[0]): Promise<void> {
  await assertCapturable(page, capture);
  await page.screenshot(options);
}
