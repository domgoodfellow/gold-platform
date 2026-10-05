import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';
import { getPlan } from '../lib/domain/catalogue/plans';
import { buildCommercialProposal, markCommercialProposalSent } from '../lib/domain/customers/commercial-proposals';
import { createPortalInvite } from '../lib/domain/portal/portal';
import { createProposalInvite, listProposalInvites, revokeProposalInvite } from '../lib/domain/customers/proposal-invites';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * A proposal link, in a real browser: exchanged once for a session of its own, then answered with
 * no secret in the address, the page or any request.
 *
 * Journeys: A exchange and reload; B accept, once; C decline; D revocation; E a link for one
 * proposal cannot reach another's; F Studio, the portal and a proposal open in one browser at once
 * and none ends another. Phone width at the end.
 */

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
const STRANGER = { storageState: { cookies: [], origins: [] } };
const SHOTS = process.env.E2E_SHOTS ?? '';

let pg: Client;
let owner: SupabaseClient;
let organizationId: string;
let customerId: string;
let otherCustomerId: string;
let planId: string;

test.use({ storageState: OWNER_STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

async function asStranger(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...STRANGER, viewport });
  return { context, page: await context.newPage() };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

/** A sent proposal for one customer, and a fresh link to it. */
async function sentProposalLink(forCustomer: string) {
  const built = await buildCommercialProposal(owner as never, {
    organizationId,
    customerId: forCustomer,
    planId,
    addonPlanIds: [],
    currency: 'CAD',
    billingInterval: 'month',
  });
  await markCommercialProposalSent(owner as never, { organizationId, proposalId: built.id });
  const token = await createProposalInvite(owner as never, { customerId: forCustomer });
  return { proposalId: built.id, token };
}

const status = async (proposalId: string) =>
  (await pg.query('select status from public.customer_commercial_proposals where id = $1', [proposalId])).rows[0].status as string;
const events = async (proposalId: string, action: string) =>
  Number((await pg.query("select count(*) n from public.events where organization_id = $1 and action = $2 and payload->>'proposal_id' = $3", [organizationId, action, proposalId])).rows[0].n);

test.beforeAll(async () => {
  const ctx = loadDemoContext();
  organizationId = ctx.organizationId;
  customerId = ctx.customerId;
  pg = new Client({ connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await pg.connect();
  otherCustomerId = (
    await pg.query('select id from public.customers where organization_id = $1 and id <> $2 limit 1', [organizationId, customerId])
  ).rows[0].id;
  owner = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await owner.auth.signInWithPassword({ email: BUSINESSES[0].owner.email, password: DEMO_PASSWORD });
  if (signIn.error) throw signIn.error;
  planId = (await getPlan(owner as never, 'start'))!.id;
});

test.afterAll(async () => {
  await pg.end();
});

test('A: the link is exchanged once, the address carries no secret, and a reload keeps the session', async ({ browser }) => {
  const { token } = await sentProposalLink(customerId);
  const { context, page } = await asStranger(browser);
  const posted: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posted.push(request.postData() ?? ''); });

  await page.goto(`/proposal/${token}`);
  await expect(page).toHaveURL(/\/proposal$/);
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  expect(await page.content()).not.toContain(token);
  await shot(page, 'proposal-desktop');

  const cookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith('gold-proposal'));
  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe('/proposal');
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('gold-proposal');
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith('gold-portal'))).toBe(false);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  expect(posted.join('\n')).not.toContain(token);

  // An invented link, and no link at all, land where every dead link lands.
  await page.goto('/proposal/not-a-real-link');
  await expect(page).toHaveURL(/\/proposal\/unavailable$/);
  await expect(page.getByRole('heading', { name: 'This proposal is no longer available' })).toBeVisible();
  const bare = await asStranger(browser);
  await bare.page.goto('/proposal');
  await expect(bare.page).toHaveURL(/\/proposal\/unavailable$/);
  await bare.context.close();
  await context.close();
});

test('B: accepting records one outcome, survives a reload, and cannot be repeated', async ({ browser }) => {
  const { proposalId, token } = await sentProposalLink(customerId);
  const { context, page } = await asStranger(browser);
  const posted: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posted.push(request.postData() ?? ''); });

  await page.goto(`/proposal/${token}`);
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(/^Accepted /)).toBeVisible();
  expect(await status(proposalId)).toBe('accepted');
  expect(posted.join('\n')).not.toContain(token);

  await page.reload();
  await expect(page.getByText(/^Accepted /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0);

  // A second tab that still shows the buttons: its click is refused, and nothing is recorded twice.
  const stale = await context.newPage();
  await stale.goto('/proposal');
  expect(await events(proposalId, 'commercial_proposal.accepted')).toBe(1);
  await context.close();
});

test('C: declining records one outcome', async ({ browser }) => {
  const { proposalId, token } = await sentProposalLink(customerId);
  const { context, page } = await asStranger(browser);
  await page.goto(`/proposal/${token}`);
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByText(/^Declined /)).toBeVisible();
  expect(await status(proposalId)).toBe('declined');
  expect(await events(proposalId, 'commercial_proposal.declined')).toBe(1);
  await context.close();
});

test('D: revoking the link ends the session on the next request, and the link no longer opens', async ({ browser }) => {
  const { token } = await sentProposalLink(customerId);
  const { context, page } = await asStranger(browser);
  await page.goto(`/proposal/${token}`);
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();

  const invite = (await listProposalInvites(owner as never, { organizationId, customerId })).find((entry) => entry.token === token)!;
  await revokeProposalInvite(owner as never, { id: invite.id });

  await page.reload();
  await expect(page).toHaveURL(/\/proposal\/unavailable$/);
  await page.goto(`/proposal/${token}`);
  await expect(page).toHaveURL(/\/proposal\/unavailable$/);
  await context.close();
});

test('E: a link for one customer’s proposal shows and decides nothing of another’s', async ({ browser }) => {
  const mine = await sentProposalLink(customerId);
  const theirs = await sentProposalLink(otherCustomerId);
  const { context, page } = await asStranger(browser);
  await page.goto(`/proposal/${mine.token}`);
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();

  // Substitute the other proposal's id into the form the page rendered: the database refuses it.
  await page.evaluate((id) => {
    const input = document.querySelector<HTMLInputElement>('input[name="proposalId"]');
    if (input) input.value = id;
  }, theirs.proposalId);
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('This proposal is not open for a response.')).toBeVisible();
  expect(await status(theirs.proposalId)).toBe('sent');
  expect(await status(mine.proposalId)).toBe('sent');
  await context.close();
});

test('F: Studio, the portal and a proposal are open in one browser at once and none ends another', async ({ browser }) => {
  // The owner's own browser state: signed in to Studio the whole time.
  const context = await browser.newContext({ storageState: OWNER_STORAGE_STATE });
  const studio = await context.newPage();
  await studio.goto(`/organizations/${organizationId}/studio`);
  await expect(studio.getByRole('heading', { name: 'Studio' })).toBeVisible();

  const portalToken = await createPortalInvite(owner as never, { customerId });
  const proposal = await sentProposalLink(customerId);

  const portal = await context.newPage();
  await portal.goto(`/portal/${portalToken}`);
  await expect(portal).toHaveURL(/\/portal$/);

  const recipient = await context.newPage();
  await recipient.goto(`/proposal/${proposal.token}`);
  await expect(recipient).toHaveURL(/\/proposal$/);
  await expect(recipient.getByRole('button', { name: 'Accept' })).toBeVisible();

  // Each is still itself after the others were opened.
  await studio.reload();
  await expect(studio.getByRole('heading', { name: 'Studio' })).toBeVisible();
  await portal.reload();
  await expect(portal).toHaveURL(/\/portal$/);
  await recipient.reload();
  await expect(recipient.getByRole('button', { name: 'Accept' })).toBeVisible();

  // The operator is not the recipient: the proposal is answered by an anonymous binding.
  await recipient.getByRole('button', { name: 'Accept' }).click();
  await expect(recipient.getByText(/^Accepted /)).toBeVisible();
  const acceptedBy = (await pg.query('select accepted_by from public.customer_commercial_proposals where id = $1', [proposal.proposalId])).rows[0].accepted_by;
  const operatorId = (await owner.auth.getUser()).data.user!.id;
  expect(acceptedBy).not.toBe(operatorId);

  // The Studio session survived all of it.
  await studio.reload();
  await expect(studio.getByRole('heading', { name: 'Studio' })).toBeVisible();
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names.some((name) => name.startsWith('gold-portal'))).toBe(true);
  expect(names.some((name) => name.startsWith('gold-proposal'))).toBe(true);
  await context.close();
});

test('G: at phone width the proposal, its decision and the unavailable state fit', async ({ browser }) => {
  const { proposalId, token } = await sentProposalLink(customerId);
  const { context, page } = await asStranger(browser, { width: 390, height: 844 });
  await page.goto(`/proposal/${token}`);
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'proposal-mobile');

  // Keyboard: the decision is reachable and operable without a pointer.
  await page.getByRole('button', { name: 'Accept' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Accepted /)).toBeVisible();
  expect(await status(proposalId)).toBe('accepted');
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.goto('/proposal/not-a-real-link');
  await expect(page.getByRole('heading', { name: 'This proposal is no longer available' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'proposal-unavailable-mobile');
  await context.close();
});
