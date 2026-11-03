import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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
import { readyEmailSender, type ReadySender } from '../tests/support/email-sender';
import { storeFixtureProviderCredential, removeFixtureProviderAccounts } from '../tests/support/provider-credentials';
import { chooseOption } from './select-field';

/**
 * Email production readiness through the real Web → API path (Phase 3C).
 *
 * The real apps/api runs locally (`apps/api/dev.py`) on the web's `GOLD_API_URL`, with every
 * Supabase setting pointed at the local stack (its own `.env` names a hosted project; nothing here
 * may reach it). Only Resend's transport is faked: `RESEND_API_BASE` points the API at a fake on
 * this machine, which the API honours only for a loopback address. Webhooks are signed exactly as
 * Resend signs them. Sign-up codes come from the local mail catcher. Disposable businesses only.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const ROOT = path.join(__dirname, '../../..');
const OUT = path.join(ROOT, '.artifacts', 'email-production-3c');
const MAILPIT = 'http://127.0.0.1:54324';
const API = 'http://127.0.0.1:8787';
const FAKE = 'http://127.0.0.1:8790';
const PLATFORM_FROM = 'invites@mail.gildops.test';
const BOOTSTRAP_KEY = 'fake-bootstrap-key';
const DOMAIN_KEY = 'fake-domain-key';
const INVITATION_SECRET = `whsec_${randomBytes(24).toString('base64')}`;
const TENANT_SECRET = `whsec_${randomBytes(24).toString('base64')}`;

type Account = { email: string; password: string; id: string };
type Sent = { authorization: string; idempotency: string; body: { from: string; to: string[]; subject: string; text: string; reply_to?: string; tags?: { name: string; value: string }[] } };

let pg: Client;
let admin: SupabaseClient<Database>;
let ownerDb: SupabaseClient<Database>;
let localEnv: Record<string, string>;
let owner: Account; let existing: Account; let stranger: Account; let staff: Account;
let orgA: string; let roleId: string; let roleName: string; let sender: ReadySender;
const organizations: string[] = []; const users: string[] = []; const accounts: string[] = [];

// --- the fake Resend ----------------------------------------------------------------------------
let fake: Server;
let emailMode: 'accept' | 'reject' = 'accept';
let domainMode: 'verified' | 'pending' | 'down' = 'verified';
const sends: Sent[] = [];
const receivingReads: string[] = [];

function startFake(): Promise<void> {
  fake = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const reply = (status: number, body: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      const url = request.url ?? '';
      if (request.method === 'POST' && url === '/emails') {
        sends.push({ authorization: String(request.headers.authorization), idempotency: String(request.headers['idempotency-key']), body: JSON.parse(raw) });
        return emailMode === 'accept' ? reply(200, { id: `re_${randomUUID()}` }) : reply(422, { name: 'validation_error', message: 'The to address was rejected' });
      }
      if (request.method === 'GET' && url === '/domains') {
        if (domainMode === 'down') return reply(503, { message: 'unavailable' });
        return reply(200, { data: [{ name: 'mail.gildops.test', status: domainMode }] });
      }
      if (request.method === 'GET' && /^\/emails\/receiving\/[^/]+\/attachments$/.test(url)) return reply(200, { data: [] });
      if (request.method === 'GET' && /^\/emails\/receiving\/[^/]+$/.test(url)) {
        receivingReads.push(String(request.headers.authorization));
        return reply(200, { text: 'Hello', html: null, message_id: `<${randomUUID()}@mail.test>`, headers: [] });
      }
      if (request.method === 'GET' && /^\/emails\/[^/]+$/.test(url)) return reply(200, { message_id: `<${randomUUID()}@resend.test>` });
      return reply(404, {});
    });
  });
  return new Promise((resolve) => fake.listen(8790, '127.0.0.1', () => resolve()));
}

// --- the real API ------------------------------------------------------------------------------
let api: ChildProcess | null = null;

async function startApi(overrides: Record<string, string> = {}): Promise<void> {
  const env = {
    ...process.env,
    SUPABASE_URL: localEnv.API_URL, SUPABASE_PUBLISHABLE_KEY: localEnv.ANON_KEY, SUPABASE_ANON_KEY: localEnv.ANON_KEY, SUPABASE_JWT_SECRET: localEnv.JWT_SECRET,
    RESEND_API_BASE: FAKE, RESEND_API_KEY: BOOTSTRAP_KEY, PLATFORM_EMAIL_FROM_ADDRESS: PLATFORM_FROM,
    RESEND_WEBHOOK_SECRET: INVITATION_SECRET, TENANT_EMAIL_WEBHOOK_SECRET: TENANT_SECRET, PORT: '8787', PYTHONUTF8: '1',
    ...overrides,
  };
  // Nothing this API process can reach may be hosted.
  for (const value of [env.SUPABASE_URL, env.RESEND_API_BASE]) if (!['127.0.0.1', 'localhost'].includes(new URL(value!).hostname)) throw new Error(`Local only: ${value}`);
  api = spawn('python', [path.join(ROOT, 'apps/api/dev.py')], { env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${API}/health-check-probe`); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('The local API did not start.');
}

async function stopApi(): Promise<void> {
  if (!api) return;
  api.kill();
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${API}/health-check-probe`); await new Promise((r) => setTimeout(r, 250)); } catch { break; }
  }
  api = null;
}

function signed(secret: string, body: string): Record<string, string> {
  const id = `msg_${randomUUID()}`; const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, 'content-type': 'application/json' };
}

async function webhook(route: string, secret: string, event: unknown) {
  const body = JSON.stringify(event);
  const response = await fetch(`${API}${route}`, { method: 'POST', headers: signed(secret, body), body });
  return { status: response.status, text: await response.text() };
}

// --- people and pages --------------------------------------------------------------------------
async function newAccount(label: string): Promise<Account> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`; const password = `Pw-${randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  users.push(made.data.user.id);
  return { email, password, id: made.data.user.id };
}

async function tokenFor(account: Account): Promise<string> {
  const db = createClient<Database>(localEnv.API_URL, localEnv.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await db.auth.signInWithPassword(account); if (login.error) throw login.error;
  return login.data.session!.access_token;
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
  await chooseOption(page.getByLabel('Role'), { label: roleName });
  await page.getByRole('button', { name: 'Send invitation' }).click();
}

const linkInEmail = (sent: Sent) => /https?:\/\/\S+\/organizations\/accept-invite\/[0-9a-f]{64}/.exec(sent.body.text)![0];
const invitationRow = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });
const lastSendTo = (address: string) => [...sends].reverse().find((sent) => sent.body.to.includes(address));

test.beforeAll(async () => {
  test.setTimeout(180_000);
  config({ path: path.join(ROOT, '.env.test'), quiet: true });
  localEnv = Object.fromEntries(execSync('pnpm exec supabase status -o env', { cwd: ROOT }).toString().split(/\r?\n/)
    .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line)).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2]]));
  for (const value of [localEnv.API_URL, process.env.SUPABASE_URL!, process.env.SUPABASE_DB_URL!, process.env.E2E_BASE_URL ?? 'http://localhost:3000']) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw new Error(`Local only: ${value}`);
  }
  mkdirSync(OUT, { recursive: true });
  pg = new Client(process.env.SUPABASE_DB_URL!); await pg.connect();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  admin = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  owner = await newAccount('prod-owner'); existing = await newAccount('prod-existing'); stranger = await newAccount('prod-stranger'); staff = await newAccount('prod-staff');
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [owner.id, 'Local email production fixture']);
  try {
    ownerDb = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, options);
    const login = await ownerDb.auth.signInWithPassword(owner); if (login.error) throw login.error;
    orgA = await provisionOrganization(ownerDb, { ownerEmail: owner.email, name: 'Production email business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' });
    organizations.push(orgA);
    organizations.push(await provisionOrganization(ownerDb, { ownerEmail: existing.email, name: 'Existing account business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Sam Lee' }));
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [owner.id]);
  }
  await pg.query("insert into platform_staff(user_id,name,capabilities) values($1,'Local readiness fixture',array['platform.providers'])", [staff.id]);
  roleName = `Dispatcher ${randomUUID().slice(0, 6)}`;
  roleId = await createRole(ownerDb, { organizationId: orgA, name: roleName, capabilities: ['report.read'] });
  sender = await readyEmailSender(pg, ownerDb, orgA);
  accounts.push(sender.accountId);
  // The fixture account's key, placed directly in the local secret store (only staff may store one).
  await storeFixtureProviderCredential(pg, sender.accountId, DOMAIN_KEY);
  await startFake();
  await startApi();
});

test.afterAll(async () => {
  await stopApi();
  await new Promise<void>((resolve) => (fake ? fake.close(() => resolve()) : resolve()));
  if (!pg) return;
  const signedUp = (await pg.query("select id from auth.users where email like 'prod-new-%@example.test' and created_at > now() - interval '1 hour'")).rows.map((row) => row.id as string);
  await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
  await removeFixtureProviderAccounts(pg, accounts);
  for (const id of [...users, ...signedUp]) await admin.auth.admin.deleteUser(id);
  await pg.end();
});

test('a new person: the invitation email names the business, sign-up keeps the invitation, and they join with the role', async ({ page }) => {
  emailMode = 'accept';
  await signIn(page, owner);
  const invitee = `prod-new-${randomUUID().slice(0, 8)}@example.test`;
  await invite(page, invitee);
  await expect(page.getByRole('status').filter({ hasText: 'Invitation emailed.' })).toBeVisible();

  // What the real API sent: GildOps' own sender and bootstrap key, the wording, the link.
  const sent = lastSendTo(invitee)!;
  expect(sent.authorization).toBe(`Bearer ${BOOTSTRAP_KEY}`);
  expect(sent.body.from).toBe(PLATFORM_FROM);
  expect(sent.body.subject).toBe('Production email business invited you to join them on GildOps');
  expect(sent.body.text).toContain(`as ${roleName}.`);
  expect(sent.body.text).toContain(`This invitation is for ${invitee}`);
  expect(sent.body.text).toContain('separate verification code');
  const link = linkInEmail(sent);

  // Resend's delivery report, signed, through the real webhook.
  const providerId = (await pg.query("select provider_message_id from invitation_deliveries where recipient=$1 and state='queued' order by occurred_at desc limit 1", [invitee])).rows[0].provider_message_id;
  expect((await webhook('/webhooks/invitation-email', INVITATION_SECRET, { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: providerId, to: [invitee] } })).status).toBe(200);
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await expect(invitationRow(page, invitee)).toContainText('Delivered');

  await page.context().clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole('heading', { name: 'You’ve been invited to Production email business' })).toBeVisible();
  await expect(page.getByText(`invited ${invitee} to join as ${roleName}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(OUT, 'accept-signed-out-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByText(`Use ${invitee}, the address Production email business invited.`)).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(invitee);
  await page.getByLabel('Given name').fill('Nia');
  await page.getByLabel('Family name').fill('Okafor');
  const password = `Pw-${randomUUID()}`;
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/verify-email');
  await expect(page.getByText(/only confirms your address; afterwards you.ll return to your invitation to Production email business/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(`**/organizations/${orgA}/**`);
  expect((await pg.query('select m.role_id from memberships m join auth.users u on u.id=m.user_id where m.organization_id=$1 and lower(u.email)=$2', [orgA, invitee])).rows).toEqual([{ role_id: roleId }]);
  // Single use: the same link no longer works.
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole('heading', { name: 'This invitation can’t be used' })).toBeVisible();
});

test('an existing account logs in from the invitation; the wrong account is told and can switch', async ({ page }) => {
  emailMode = 'accept';
  await signIn(page, owner);
  await invite(page, existing.email);
  await expect(page.getByRole('status').filter({ hasText: 'Invitation emailed.' })).toBeVisible();
  const link = linkInEmail(lastSendTo(existing.email)!);

  await signIn(page, stranger);
  await page.goto(new URL(link).pathname);
  await expect(page.getByText(`This invitation works only for ${existing.email}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  await page.getByRole('button', { name: `Sign out and continue as ${existing.email}` }).click();
  await page.waitForURL('**/login');
  await expect(page.getByText(`Log in with ${existing.email} to accept your invitation to Production email business.`)).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(existing.email);
  await page.getByLabel('Password', { exact: true }).fill(existing.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(`**${new URL(link).pathname}`);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(`**/organizations/${orgA}/**`);
  expect((await pg.query('select role_id from memberships where organization_id=$1 and user_id=$2', [orgA, existing.id])).rows).toEqual([{ role_id: roleId }]);
  expect((await pg.query('select count(*)::int n from memberships where organization_id=$1 and user_id=$2', [orgA, stranger.id])).rows[0].n).toBe(0);
});

test('a provider refusal, a missing platform sender and an unreachable API are each said plainly', async ({ page }) => {
  await signIn(page, owner);
  emailMode = 'reject';
  const refused = `prod-refused-${randomUUID().slice(0, 8)}@example.test`;
  await invite(page, refused);
  await expect(page.getByRole('status').filter({ hasText: 'not emailed' })).toContainText('The to address was rejected');
  await page.goto(`/organizations/${orgA}/settings/access/invitations`);
  await expect(invitationRow(page, refused)).toContainText('Failed');
  emailMode = 'accept';

  await stopApi();
  await startApi({ PLATFORM_EMAIL_FROM_ADDRESS: '' });
  try {
    const unset = `prod-unset-${randomUUID().slice(0, 8)}@example.test`;
    const before = sends.length;
    await invite(page, unset);
    await expect(page.getByRole('status').filter({ hasText: 'not emailed' })).toContainText(/GildOps. invitation email is not set up on this deployment yet\./);
    expect(sends.length).toBe(before);
  } finally {
    await stopApi();
  }
  try {
    const down = `prod-down-${randomUUID().slice(0, 8)}@example.test`;
    await invite(page, down);
    await expect(page.getByRole('status').filter({ hasText: 'not emailed' })).toContainText('could not be reached');
  } finally {
    await startApi();
  }
});

test('a test email goes from the business’s own sender to the manager only, a few times at most', async ({ page }) => {
  emailMode = 'accept';
  await signIn(page, owner);
  await page.goto(`/organizations/${orgA}/settings/email`);
  await page.getByRole('button', { name: 'Send test email to me' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test email accepted for delivery' })).toContainText(owner.email.toLowerCase());
  const sent = lastSendTo(owner.email.toLowerCase())!;
  expect(sent.authorization).toBe(`Bearer ${DOMAIN_KEY}`);
  expect(sent.body.from).toBe(sender.address);
  expect(sent.body.tags?.[0]).toMatchObject({ name: 'gildops_test_send' });
  expect(sent.idempotency).toBe(sent.body.tags?.[0].value);
  await expect(page.getByRole('list', { name: 'Recent test emails' })).toContainText('Accepted for delivery');

  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Send test email to me' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Test email accepted for delivery' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Send test email to me' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Too many test emails' })).toBeVisible();

  // Nobody else can ask the API for one.
  const refused = await fetch(`${API}/email/test-send`, { method: 'POST', headers: { authorization: `Bearer ${await tokenFor(stranger)}`, 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: orgA }) });
  expect(refused.status).toBe(403);

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/organizations/${orgA}/settings/email`);
    await expect(page.getByRole('heading', { name: 'Where replies go' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(OUT, `email-sending-${width}.png`), fullPage: true });
  }
});

test('received mail is read with its own domain’s account, and a tagged report settles an uncertain delivery', async () => {
  await pg.query('update email_identities set can_receive=true where id=$1', [sender.identityId]);
  const before = receivingReads.length;
  await webhook('/webhooks/tenant-email', TENANT_SECRET, { type: 'email.received', created_at: new Date().toISOString(), data: { email_id: `in_${randomUUID()}`, from: 'kim@example.test', to: [sender.address], subject: 'Hi', message_id: '<m@x>' } });
  expect(receivingReads.slice(before)).toEqual([`Bearer ${DOMAIN_KEY}`]);
  const unknown = await webhook('/webhooks/tenant-email', TENANT_SECRET, { type: 'email.received', created_at: new Date().toISOString(), data: { email_id: `in_${randomUUID()}`, from: 'kim@example.test', to: ['nobody@nowhere.test'], subject: 'Hi' } });
  expect(unknown.text).toBe('ignored');
  expect(receivingReads.length).toBe(before + 1);

  const delivery = (await pg.query(
    "insert into message_deliveries(organization_id,rule_id,rule_name,subject_type,subject_id,channel,recipient,body,state,detail,email_identity_id,attempts,first_attempt_at) values($1,$2,'Confirm','work_item',$3,'email','ana@example.test','Hi','uncertain','Delivery uncertain: answer lost',$4,1,now()) returning id",
    [orgA, randomUUID(), randomUUID(), sender.identityId],
  )).rows[0].id;
  const providerId = `re_${randomUUID()}`;
  expect((await webhook('/webhooks/tenant-email', TENANT_SECRET, { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: providerId, tags: { gildops_delivery: delivery } } })).status).toBe(200);
  expect((await pg.query('select state, external_id, provider_state from message_deliveries where id=$1', [delivery])).rows[0]).toEqual({ state: 'sent', external_id: providerId, provider_state: 'delivered' });
});

test('platform staff get the API’s own email readiness, with nothing secret in it', async () => {
  const ask = async (account: Account) => fetch(`${API}/platform/email-readiness`, { method: 'POST', headers: { authorization: `Bearer ${await tokenFor(account)}`, 'content-type': 'application/json' }, body: '{}' });
  domainMode = 'verified';
  const ready = await ask(staff);
  const answer = await ready.json() as { state: string; credential_source: string; from_domain: string; evidence: { last_delivered_at: string | null } };
  // The first test recorded a provider-signed delivery of an invitation, so this is live-verified,
  // not merely ready for a test (that state is held by the API's own tests).
  expect(answer).toMatchObject({ state: 'live_verified', credential_source: 'environment', from_domain: 'mail.gildops.test' });
  expect(answer.evidence.last_delivered_at).not.toBeNull();
  const text = JSON.stringify(answer);
  for (const secret of [BOOTSTRAP_KEY, PLATFORM_FROM, INVITATION_SECRET, TENANT_SECRET]) expect(text).not.toContain(secret);
  domainMode = 'pending';
  expect(((await (await ask(staff)).json()) as { state: string }).state).toBe('configured_unverified');
  domainMode = 'down';
  expect(((await (await ask(staff)).json()) as { state: string }).state).toBe('provider_unavailable');
  domainMode = 'verified';
  expect((await ask(owner)).status).toBe(403);
});
