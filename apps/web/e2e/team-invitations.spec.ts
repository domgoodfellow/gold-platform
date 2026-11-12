import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createRole } from '../lib/domain/tenancy/roles';
import { readyEmailSender } from '../tests/support/email-sender';
import { chooseOption } from './select-field';

/**
 * Team invitations and Email sending settings, in the rendered application (Phase 3B).
 *
 * GildOps' own invitation email is sent by apps/api. Here a stand-in for apps/api listens where this
 * local app expects it (`GOLD_API_URL`, 127.0.0.1:8787) and records each send exactly as the real
 * one does (`record_invitation_delivery`), so the page shows what a manager would see for an
 * accepted, refused, unconfigured or unreachable mail service — without any real email. Account
 * verification codes come from the local mail catcher. Disposable loopback businesses only, removed
 * afterwards by this run.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const OUT = path.join(__dirname, '../../..', '.artifacts', 'email-sending-3b');
const MAILPIT = 'http://127.0.0.1:54324';
type Account = { email: string; password: string; id: string };
type Mode = 'accept' | 'refuse' | 'unconfigured';

let pg: Client;
let admin: SupabaseClient<Database>;
let ownerDb: SupabaseClient<Database>;
let owner: Account; let existing: Account; let stranger: Account;
let orgA: string; let orgB: string; let roleId: string; let roleName: string;
const organizations: string[] = [];
const users: string[] = [];
const accounts: string[] = [];
let mock: Server | null = null;
let mode: Mode = 'accept';
const sent: { invitationId: string; link: string }[] = [];

function local(value: string) {
  if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error(`Disposable loopback fixtures only: ${value}`);
}

async function startMock(): Promise<void> {
  mock = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', async () => {
      if (request.method !== 'POST' || request.url !== '/invitations/email') { response.writeHead(404).end('{}'); return; }
      const input = JSON.parse(body || '{}') as { organization_id: string; invitation_id: string; link: string };
      const recipient = (await pg.query('select email from public.organization_invitations where id=$1', [input.invitation_id])).rows[0]?.email;
      const answer = mode === 'accept'
        ? { sent: true, external_id: `re_${randomUUID()}`, detail: null }
        : { sent: false, external_id: null, detail: mode === 'refuse' ? 'Resend refused the request (422): the recipient address was rejected' : 'GildOps’ invitation email is not set up on this deployment yet.' };
      // What apps/api records for the same answer: accepted for delivery, or failed with its reason.
      await pg.query('begin'); await pg.query('set local role provider_operator');
      await pg.query('select public.record_invitation_delivery($1,$2,$3,$4,$5,$6)', [input.organization_id, input.invitation_id, recipient, answer.sent ? 'queued' : 'failed', answer.external_id, answer.detail]);
      await pg.query('commit');
      if (answer.sent) sent.push({ invitationId: input.invitation_id, link: input.link });
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve, reject) => { mock!.once('error', reject); mock!.listen(8787, '127.0.0.1', resolve); });
}
async function stopMock(): Promise<void> { if (mock) await new Promise<void>((resolve) => mock!.close(() => resolve())); mock = null; }

async function newAccount(label: string): Promise<Account> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`; const password = `Pw-${randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  users.push(made.data.user.id);
  return { email, password, id: made.data.user.id };
}

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function invite(page: Page, email: string) {
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await page.getByRole('button', { name: 'Add member' }).click();
  await page.getByLabel('Email address').fill(email);
  await chooseOption(page.getByLabel('Role', { exact: true }), { label: roleName });
  await page.getByRole('button', { name: 'Send invitation' }).click();
}

const linkFor = (page: Page) => page.getByRole('textbox', { name: /Invitation link/ }).inputValue();
const invitationRow = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!; const connection = process.env.SUPABASE_DB_URL!;
  for (const value of [url, connection, process.env.E2E_BASE_URL ?? 'http://localhost:3000', MAILPIT]) local(value);
  mkdirSync(OUT, { recursive: true });
  pg = new Client(connection); await pg.connect();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  owner = await newAccount('invite-owner'); existing = await newAccount('invite-existing'); stranger = await newAccount('invite-stranger');
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [owner.id, 'Local invitation fixture']);
  try {
    ownerDb = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
    const login = await ownerDb.auth.signInWithPassword(owner); if (login.error) throw login.error;
    orgA = await provisionOrganization(ownerDb, { ownerEmail: owner.email, name: 'Invitations business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' });
    organizations.push(orgA);
    orgB = await provisionOrganization(ownerDb, { ownerEmail: existing.email, name: 'Existing account business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Sam Lee' });
    organizations.push(orgB);
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [owner.id]);
  }
  roleName = `Invited helper ${randomUUID().slice(0, 6)}`;
  roleId = await createRole(ownerDb, { organizationId: orgA, name: roleName, capabilities: ['report.read'] });
  await startMock();
});

test.afterAll(async () => {
  await stopMock();
  if (!pg) return;
  // Accounts this run's own sign-up made are found by the run's own addresses.
  const signedUp = (await pg.query("select id from auth.users where email like 'invite-new-%@example.test' and created_at > now() - interval '1 hour'")).rows.map((row) => row.id as string);
  await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
  await pg.query('delete from platform_provider_accounts where id=any($1::uuid[])', [accounts]);
  for (const id of [...users, ...signedUp]) await admin.auth.admin.deleteUser(id);
  await pg.end();
});

test('an accepted invitation says so without claiming delivery, and a new person joins with the chosen role', async ({ page }) => {
  mode = 'accept';
  await signIn(page, owner);
  const invitee = `invite-new-${randomUUID().slice(0, 8)}@example.test`;
  await invite(page, invitee);
  await expect(page.getByRole('status').filter({ hasText: 'Invitation emailed.' })).toContainText('accepted it for delivery');
  // The link is an explicit alternative, never shown as though it were the email.
  await expect(page.getByRole('textbox', { name: 'Invitation link' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy the invitation link instead' }).click();
  const link = await linkFor(page);
  expect(sent.at(-1)?.link).toBe(link);
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await expect(invitationRow(page, invitee)).toContainText('Accepted for delivery');

  // The recipient, signed out, creates an account with the code the sign-in service emails.
  await page.context().clearCookies();
  await page.goto(new URL(link).pathname);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Given name').fill('Nia');
  await page.getByLabel('Family name').fill('Okafor');
  await page.getByLabel('Email', { exact: true }).fill(invitee);
  const password = `Pw-${randomUUID()}`;
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/verify-email');
  let code = '';
  await expect.poll(async () => {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${invitee}`)}`)).json() as { messages: { ID: string }[] };
    if (!found.messages.length) return '';
    const message = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json() as { Text: string };
    code = /\b(\d{6,10})\b/.exec(message.Text)?.[1] ?? '';
    return code;
  }, { timeout: 20_000 }).not.toBe('');
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify email' }).click();
  await page.waitForURL(`**${new URL(link).pathname}`);
  await expect(page.getByText(`You’re signed in as ${invitee}`)).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(`**/organizations/${orgA}/**`);
  const member = (await pg.query('select m.role_id from memberships m join auth.users u on u.id=m.user_id where m.organization_id=$1 and lower(u.email)=$2', [orgA, invitee])).rows;
  expect(member).toEqual([{ role_id: roleId }]);
});

test('an existing account joins another business without a new account, and nobody else can use its link', async ({ page }) => {
  mode = 'accept';
  await signIn(page, owner);
  await invite(page, existing.email);
  await page.getByRole('button', { name: 'Copy the invitation link instead' }).click();
  const link = await linkFor(page);

  // Somebody signed in with a different address is refused.
  await signIn(page, stranger);
  await page.goto(new URL(link).pathname);
  // Phase 3C: the page says whose invitation it is and offers no Accept to the wrong account.
  await expect(page.getByText(`This invitation works only for ${existing.email}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  expect((await pg.query('select count(*)::int n from memberships where organization_id=$1 and user_id=$2', [orgA, stranger.id])).rows[0].n).toBe(0);

  await signIn(page, existing);
  await page.goto(new URL(link).pathname);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(`**/organizations/${orgA}/**`);
  expect((await pg.query('select role_id from memberships where organization_id=$1 and user_id=$2', [orgA, existing.id])).rows).toEqual([{ role_id: roleId }]);
  // Still a member of the business it already belonged to.
  expect((await pg.query('select count(*)::int n from memberships where organization_id=$1 and user_id=$2', [orgB, existing.id])).rows[0].n).toBe(1);
});

test('a refused, unconfigured or unreachable mail service is said plainly, with the link offered to share', async ({ page }) => {
  await signIn(page, owner);
  for (const [setting, reason] of [
    ['refuse', 'the recipient address was rejected'],
    ['unconfigured', 'GildOps’ invitation email is not set up on this deployment yet.'],
  ] as const) {
    mode = setting;
    const invitee = `invite-fail-${randomUUID().slice(0, 8)}@example.test`;
    await invite(page, invitee);
    const status = page.getByRole('status').filter({ hasText: 'Invitation created, but it was not emailed.' });
    await expect(status).toContainText(reason);
    await expect(page.getByText('Invitation emailed.')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Invitation link' })).toBeVisible();
    await page.goto(`/organizations/${orgA}/settings/access/invitations`);
    await expect(invitationRow(page, invitee)).toContainText('Failed');
    await expect(invitationRow(page, invitee)).toContainText(reason);
  }

  await stopMock();
  try {
    const invitee = `invite-down-${randomUUID().slice(0, 8)}@example.test`;
    await invite(page, invitee);
    await expect(page.getByRole('status').filter({ hasText: 'not emailed' })).toContainText('could not be reached');
    await page.goto(`/organizations/${orgA}/settings/access/invitations`);
    await expect(invitationRow(page, invitee)).toContainText('Not emailed');
  } finally {
    await startMock();
  }
});

test('resending replaces the link, and revoked or expired invitations no longer work', async ({ page }) => {
  mode = 'refuse';
  await signIn(page, owner);
  const invitee = `invite-resend-${randomUUID().slice(0, 8)}@example.test`;
  await invite(page, invitee);
  const first = await linkFor(page);

  mode = 'accept';
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await invitationRow(page, invitee).getByRole('button', { name: 'Resend' }).click();
  await expect(page.getByText('The previous link no longer works.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation emailed.' })).toBeVisible();
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await expect(invitationRow(page, invitee)).toContainText('Accepted for delivery');

  // The old link is dead for everyone, even the right person.
  const invited = await newAccount('invite-resend-account');
  await pg.query('update auth.users set email=$1 where id=$2', [invitee, invited.id]);
  await signIn(page, { email: invitee, password: invited.password });
  await page.goto(new URL(first).pathname);
  // Phase 3C: a dead link has its own page, saying only that it cannot be used.
  await expect(page.getByRole('heading', { name: 'This invitation can’t be used' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);

  // Expired: the current link stops working once its time has passed.
  const current = sent.at(-1)!.link;
  await pg.query("update public.organization_invitations set expires_at=now()-interval '1 minute' where organization_id=$1 and email=$2 and accepted_at is null and revoked_at is null", [orgA, invitee]);
  await page.goto(new URL(current).pathname);
  // Phase 3C: a dead link has its own page, saying only that it cannot be used.
  await expect(page.getByRole('heading', { name: 'This invitation can’t be used' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);

  // Revoked: a fresh invitation, revoked by the manager, cannot be accepted.
  await signIn(page, owner);
  const revokee = `invite-revoke-${randomUUID().slice(0, 8)}@example.test`;
  await invite(page, revokee);
  await page.getByRole('button', { name: 'Copy the invitation link instead' }).click();
  const revoked = await linkFor(page);
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await invitationRow(page, revokee).getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Revoke invitation' }).click();
  await expect(invitationRow(page, revokee)).toHaveCount(0);
  const revokedAccount = await newAccount('invite-revoke-account');
  await pg.query('update auth.users set email=$1 where id=$2', [revokee, revokedAccount.id]);
  await signIn(page, { email: revokee, password: revokedAccount.password });
  await page.goto(new URL(revoked).pathname);
  // Phase 3C: a dead link has its own page, saying only that it cannot be used.
  await expect(page.getByRole('heading', { name: 'This invitation can’t be used' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
});

test('Email sending settings say what is missing, then which address sends, at every width', async ({ page }) => {
  await signIn(page, owner);
  const settings = `/organizations/${orgA}/settings/email`;
  await page.goto(settings);
  await expect(page.getByRole('heading', { level: 1, name: 'Email sending' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not set up yet' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('bookings themselves still work');
  // No sentence about team invitations: that copy was removed in "Enforce UI copy discipline", and
  // invitations sending without this page's setup is proved by the invitation tests above.
  // Organization Settings lists it; Communications links to it and keeps Incoming email.
  await expect(page.getByRole('link', { name: 'Email sending', exact: true }).first()).toHaveAttribute('href', settings);
  await expect(page.getByRole('link', { name: 'Communications → Incoming email' })).toHaveAttribute('href', `/organizations/${orgA}/comms/configuration/email`);
  // Nothing about the provider's account or keys is on the page.
  await expect(page.getByText(/resend|api key|re_/i)).toHaveCount(0);

  const first = await readyEmailSender(pg, ownerDb, orgA, { makeDefault: false });
  accounts.push(first.accountId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a default sender' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: first.address });
  await expect(row).toContainText('Ready to send');
  await row.getByRole('button', { name: 'Make default' }).click();
  await expect(page.getByRole('heading', { name: 'Ready to send' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(`sent from ${first.address}`);
  await expect(page.getByRole('listitem').filter({ hasText: first.address })).toContainText('Default');

  // Changing the default moves it.
  const second = await readyEmailSender(pg, ownerDb, orgA, { makeDefault: false });
  await page.reload();
  await page.getByRole('listitem').filter({ hasText: second.address }).getByRole('button', { name: 'Make default' }).click();
  await expect(page.getByRole('status')).toContainText(`sent from ${second.address}`);
  await expect(page.getByRole('listitem').filter({ hasText: first.address }).getByRole('button', { name: 'Make default' })).toBeVisible();

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(settings);
    await expect(page.getByRole('heading', { name: 'Ready to send' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(OUT, `email-sending-${width}.png`), fullPage: true });
  }
  await page.goto(`/organizations/${orgA}/comms/configuration/email`);
  await expect(page.getByRole('heading', { level: 1, name: 'Incoming email' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add address' })).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'inbox-email-1440.png'), fullPage: true });

  // A member who may not configure the business cannot open Email sending.
  await signIn(page, existing);
  await page.goto(settings);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
});
