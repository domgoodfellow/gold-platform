import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { holdPlatformProviderTables, releasePlatformProviderTables } from '@/tests/support/exclusive';
import type { TelephonyAccountOperations } from '@/lib/adapters/telephony';
import {
  getProviderAccount,
  listProviderAccounts,
  listProviderOrganizationStandings,
  setDefaultProviderAccount,
  setProviderAccountStatus,
} from '@/lib/domain/providers/accounts';
import { beginProviderBinding, setProviderBindingStatus } from '@/lib/domain/providers/bindings';
import { compareWithRemote, localHealth } from '@/lib/domain/providers/reconciliation';
import { providerReadiness } from '@/lib/domain/providers/status';
import { provisionTelephonySubaccount } from '@/lib/domain/providers/twilio-provisioning';
import {
  configureTelephonyAccount,
  reconcileTelephonyAccount,
  verifyTelephonyAccount,
} from '@/lib/domain/providers/telephony-accounts';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * GOLD's own provider account: who may see and change it, that its credential goes in and never
 * comes out, that an organization is provisioned once under the right account, and that
 * reconciliation reports what differs and touches nothing.
 *
 * **What is mocked is the carrier and the API in front of it, and nothing else.** The database is
 * real, with real grants, so every refusal below is Postgres's own. The Python half — that a
 * caller is proved staff before a credential is read — is `apps/api/tests/component/test_provider_operations.py`.
 */

// The carrier, reached through `apps/api`. Recorded so a test can count what was created.
const calls = { createSubaccount: 0, createApiKey: 0, createTwimlApp: 0, verify: 0 };
let remoteSubaccounts: { sid: string; friendlyName: string | null; status: string | null }[] = [];
let verifyAnswer = { ok: true, error: null as string | null, metadata: {} as Record<string, unknown> };
let onVerify: (() => Promise<void>) | null = null;

vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  requireAccessToken: async () => 'test-token',
}));

vi.mock('@/lib/adapters/telephony', async (original) => {
  const real = await original<typeof import('@/lib/adapters/telephony')>();
  const operations: TelephonyAccountOperations = {
    async verify() {
      calls.verify += 1;
      await onVerify?.();
      return verifyAnswer;
    },
    async listSubaccounts() {
      return remoteSubaccounts;
    },
    provisioner: {
      async createSubaccount() {
        calls.createSubaccount += 1;
        return { sid: `AC${randomUUID().replace(/-/g, '')}` };
      },
      async createApiKey() {
        calls.createApiKey += 1;
        return { sid: `SK${randomUUID().replace(/-/g, '')}`, secret: 'a-tenant-key-secret' };
      },
      async createTwimlApp() {
        calls.createTwimlApp += 1;
        return { sid: `AP${randomUUID().replace(/-/g, '')}` };
      },
    },
  };
  return { ...real, telephonyAccountOperations: async () => operations, callbackBase: () => 'https://api.test' };
});

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SECRET = `parent-secret-${randomUUID()}`;
const sid = (prefix: string) => prefix + randomUUID().replace(/-/g, '');

let pg: Client;
let staff: SupabaseClient;
let tenant: { db: SupabaseClient; organizationId: string };
let second: { organizationId: string };

async function newTenant(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'USD' });
  return { db, organizationId };
}

/** Acts as the one machine role that may read a credential or record a verification. */
async function asOperator<T>(run: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role provider_operator');
    const result = await run();
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

async function wipe() {
  // Bindings point at accounts with no cascade; release them first so a re-run starts clean.
  await pg.query('update public.organization_provider_bindings set provider_account_id = null');
  await pg.query('delete from public.platform_provider_accounts');
}

const IDENTITY = {
  label: 'GOLD parent',
  externalAccountId: sid('AC').slice(0, 34),
  credentialKind: 'api_key',
  credentialIdentifier: sid('SK').slice(0, 34),
};

let accountId: string;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await holdPlatformProviderTables(pg);
  await wipe();
  staff = await asPlatformStaff();
  tenant = await newTenant('acct-tenant');
  second = await newTenant('acct-second');
}, 300_000);

afterAll(async () => {
  await wipe();
  await releasePlatformProviderTables(pg);
  await pg?.end();
});

describe('who may see and change a GOLD provider account', () => {
  it('lets platform staff record an account, and makes the first one the default', async () => {
    accountId = await configureTelephonyAccount(staff, { ...IDENTITY, secret: SECRET });
    const account = await getProviderAccount(staff, accountId);

    expect(account).toMatchObject({
      providerKey: 'twilio',
      label: 'GOLD parent',
      status: 'active',
      isDefault: true,
      verificationState: 'unverified',
    });
    expect(account?.credentialSetAt).not.toBeNull();
  });

  it('shows an organization user nothing and refuses every write', async () => {
    const seen = await tenant.db.from('platform_provider_accounts').select('id');
    expect(seen.data ?? []).toEqual([]);

    const write = await tenant.db.rpc('record_provider_account', {
      p_provider_key: 'twilio',
      p_label: 'mine',
      p_external_account_id: sid('AC').slice(0, 34),
      p_credential_kind: 'api_key',
      p_credential_identifier: '',
    });
    expect(write.error).not.toBeNull();

    const credential = await tenant.db.rpc('store_provider_account_credential', { p_account_id: accountId, p_secret: 'x' });
    expect(credential.error).not.toBeNull();
    const status = await tenant.db.rpc('set_provider_account_status', { p_account_id: accountId, p_status: 'disabled' });
    expect(status.error).not.toBeNull();
    expect((await getProviderAccount(staff, accountId))?.status).toBe('active');
  });

  it('keeps the provider account off a tenant’s own view of its binding', async () => {
    // A separate organization: a binding begun without an account is a bootstrap binding for good.
    const viewer = await newTenant('acct-viewer');
    await beginProviderBinding(staff, { organizationId: viewer.organizationId, providerKey: 'twilio' });

    const own = await viewer.db.from('organization_provider_bindings').select('id, status').eq('organization_id', viewer.organizationId);
    expect(own.error).toBeNull();
    expect(own.data?.length).toBe(1);

    const parent = await viewer.db.from('organization_provider_bindings').select('provider_account_id');
    expect(parent.error?.code).toBe('42501');
    const staffDirect = await staff.from('organization_provider_bindings').select('provider_account_id');
    expect(staffDirect.error?.code).toBe('42501');
  });
});

describe('a credential goes in and never comes out', () => {
  it('is withheld from every column grant, for staff too', async () => {
    const direct = await staff.from('platform_provider_accounts').select('secret_id');
    expect(direct.error?.code).toBe('42501');
    const all = await staff.from('platform_provider_accounts').select('*');
    expect(all.error?.code).toBe('42501');
  });

  it('is executable by no signed-in role, staff included', async () => {
    const asStaff = await staff.rpc('read_provider_account_credential', { p_account_id: accountId });
    expect(asStaff.error?.code).toBe('42501');
    const asTenant = await tenant.db.rpc('read_provider_account_credential', { p_account_id: accountId });
    expect(asTenant.error?.code).toBe('42501');

    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', 'public.read_provider_account_credential(uuid)', 'execute') as authenticated,
              has_function_privilege('anon', 'public.read_provider_account_credential(uuid)', 'execute') as anon,
              has_function_privilege('provider_operator', 'public.read_provider_account_credential(uuid)', 'execute') as operator`,
    );
    expect(rows[0]).toEqual({ authenticated: false, anon: false, operator: true });
  });

  it('lets staff set a value and returns none of it', async () => {
    const { data, error } = await staff.rpc('store_provider_account_credential', { p_account_id: accountId, p_secret: SECRET });
    expect(error).toBeNull();
    expect(data).toBe(accountId);
    expect(JSON.stringify(await listProviderAccounts(staff))).not.toContain(SECRET);
  });

  it('is readable back by the machine role alone, and only for an active account', async () => {
    const read = await asOperator(() =>
      pg.query('select secret, credential_kind from public.read_provider_account_credential($1)', [accountId]),
    );
    expect(read.rows[0]).toEqual({ secret: SECRET, credential_kind: 'api_key' });

    await setProviderAccountStatus(staff, { accountId, status: 'disabled' });
    const disabled = await asOperator(() => pg.query('select secret from public.read_provider_account_credential($1)', [accountId]));
    expect(disabled.rows).toEqual([]);
    // Disabling gave up the default, and enabling does not take it back on its own.
    expect((await getProviderAccount(staff, accountId))?.isDefault).toBe(false);
    await setProviderAccountStatus(staff, { accountId, status: 'active' });
    await setDefaultProviderAccount(staff, { accountId });
  });

  it('leaves Vault itself unreachable to every signed-in role', async () => {
    const { rows } = await pg.query(
      `select has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') as decrypted,
              has_table_privilege('authenticated', 'vault.secrets', 'select') as secrets`,
    );
    expect(rows[0]).toEqual({ decrypted: false, secrets: false });
  });

  it('gives the machine role no table grant and exactly twenty-six executes', async () => {
    const tables = await pg.query(`select table_name from information_schema.role_table_grants where grantee = 'provider_operator'`);
    expect(tables.rows).toEqual([]);

    const functions = await pg.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('provider_operator', p.oid, 'execute')
          and not has_function_privilege('authenticated', p.oid, 'execute')
        order by p.proname`,
    );
    // `resolve_ai_runtime_assignment` joined the other two once apps/api needed to resolve which
    // Provider Account answers an AI capability; the three `custom_domain_*` doors joined once a
    // business's own domain needed a hosting provider's answer recorded; `default_platform_provider_account`
    // and `record_invitation_delivery` joined once sending an invitation needed to resolve Resend's
    // default account and record what happened without the caller having to be staff; the two
    // `email_domain_*`/`record_email_domain_provisioning` doors joined once a business's own
    // sending domain needed the same thing recorded — the same machine role, narrow doors added
    // one capability at a time, never a table grant. `claim_email_for_send` and
    // `record_email_send_result` joined once a business's own email needed the same: apps/api,
    // after proving the caller may send one message, says what the provider answered.
    // `resolve_public_agent_turn` and `record_public_communication_reply` joined with website
    // chat: apps/api assembles one visitor turn for an enabled deployment and records the reply
    // (or a handoff) on that visitor's open thread. Both derive the organization from the thread
    // or deployment, set `search_path = ''`, refuse a closed thread or a disabled deployment,
    // and are granted to this role alone — never to a signed-in or anonymous caller.
    // `email_sender_account` joined with the organization sender (Phase 3A): before sending an Inbox
    // email, apps/api asks the one sender resolution whether the address is still this business's
    // and ready, and which recorded account holds its domain. It answers rather than raises.
    // Phase 3C: `email_receiving_account` reads received mail only through the receiving address's
    // recorded account; `email_test_send_account`/`finish_email_test_send` send and record one
    // manager-started test. The six `*voice_agent*` doors joined with the voice receptionist
    // (20261227000003/7) without this list being updated, which is what made it fail: reviewed in
    // Phase 3C, each acts only on the named call or session row, checks its state and organization,
    // sets `search_path = ''`, and is called only by apps/api's voice agent service, which must also
    // read the voice provider's credential — so this role, and no signed-in or anonymous caller.
    expect(functions.rows.map((row) => row.proname)).toEqual([
      'admit_voice_agent_session',
      'bind_voice_agent_session',
      'claim_email_for_send',
      'claim_voice_agent_transfer',
      'custom_domain_provider_account',
      'default_platform_provider_account',
      'email_domain_provider_account',
      'email_receiving_account',
      'email_sender_account',
      'email_test_send_account',
      'finish_email_test_send',
      'mark_voice_agent_uncertain',
      'read_provider_account_credential',
      'record_ai_usage',
      'record_custom_domain_registration',
      'record_email_domain_provisioning',
      'record_email_send_result',
      'record_invitation_delivery',
      'record_provider_account_verification',
      'record_public_communication_reply',
      'record_voice_agent_event',
      'resolve_ai_runtime_assignment',
      'resolve_public_agent_turn',
      'resolve_public_assistant',
      'set_custom_domain_verification',
      'voice_agent_session_context',
    ]);
  });

  it('is never selected, decrypted or held by anything in apps/web', () => {
    const root = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        if (['node_modules', '.next', 'tests'].includes(entry)) return [];
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(entry) && !entry.endsWith('database.types.ts') ? [path] : [];
      });
    const offenders = files(root).filter((path) =>
      /decrypted_secrets|read_provider_account_credential|(?<![a-z_])secret_id/i.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
    );
    expect(offenders.map((p) => p.replace(root, ''))).toEqual([]);
  });
});

describe('verifying the account', () => {
  it('is recorded by the machine role, never by a person', async () => {
    const asStaff = await staff.rpc('record_provider_account_verification', { p_account_id: accountId, p_ok: true });
    expect(asStaff.error?.code).toBe('42501');
    expect((await getProviderAccount(staff, accountId))?.verificationState).toBe('unverified');
  });

  it('records a refusal with the provider’s words, and shows it to the operator', async () => {
    verifyAnswer = { ok: false, error: 'Twilio refused the request (401): Authenticate', metadata: {} };
    onVerify = () =>
      asOperator(async () => {
        await pg.query('select public.record_provider_account_verification($1, false, $2)', [accountId, verifyAnswer.error]);
      });

    const after = await verifyTelephonyAccount(staff, { accountId });

    expect(after.verificationState).toBe('failed');
    expect(after.verificationError).toContain('401');
    expect(after.lastVerifiedAt).not.toBeNull();
  });

  it('cannot provision under an account that has not been verified', async () => {
    await expect(provisionTelephonySubaccount(staff, { organizationId: tenant.organizationId })).rejects.toThrow(/Verify the provider account/);
  });

  it('records a success, and a replaced credential is unproven again', async () => {
    verifyAnswer = { ok: true, error: null, metadata: { friendly_name: 'GOLD' } };
    onVerify = () =>
      asOperator(async () => {
        await pg.query('select public.record_provider_account_verification($1, true, null, $2::jsonb)', [accountId, JSON.stringify(verifyAnswer.metadata)]);
      });

    const verified = await verifyTelephonyAccount(staff, { accountId });
    expect(verified).toMatchObject({ verificationState: 'verified', verificationError: null });
    expect(verified.metadata).toEqual({ friendly_name: 'GOLD' });

    await configureTelephonyAccount(staff, { accountId, ...IDENTITY, secret: `${SECRET}-rotated` });
    expect((await getProviderAccount(staff, accountId))?.verificationState).toBe('unverified');

    await verifyTelephonyAccount(staff, { accountId });
    expect((await getProviderAccount(staff, accountId))?.verificationState).toBe('verified');
  });

  it('refuses an account whose shape cannot be a real one before storing anything', async () => {
    await expect(
      configureTelephonyAccount(staff, { label: 'x', externalAccountId: 'nope', credentialKind: 'api_key', credentialIdentifier: null, secret: 's' }),
    ).rejects.toThrow(/Account SID/);
    await expect(
      configureTelephonyAccount(staff, { label: 'x', externalAccountId: IDENTITY.externalAccountId, credentialKind: 'api_key', credentialIdentifier: null, secret: 's' }),
    ).rejects.toThrow(/API key SID/);
  });
});

describe('provisioning an organization', () => {
  it('is idempotent: pressing it twice creates one subaccount, one key and one application', async () => {
    Object.assign(calls, { createSubaccount: 0, createApiKey: 0, createTwimlApp: 0 });

    const first = await provisionTelephonySubaccount(staff, { organizationId: tenant.organizationId });
    const again = await provisionTelephonySubaccount(staff, { organizationId: tenant.organizationId });

    expect(again).toEqual(first);
    expect(calls).toMatchObject({ createSubaccount: 1, createApiKey: 1, createTwimlApp: 1 });

    const [standing] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: tenant.organizationId });
    expect(standing).toMatchObject({ bindingStatus: 'active', externalAccountId: first.subaccountSid, resourceCount: 3 });
  });

  it('records which GOLD account owns the binding', async () => {
    const [standing] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: tenant.organizationId });
    expect(standing.providerAccountId).toBe(accountId);
  });

  it('keeps an existing binding under its own account when the default moves', async () => {
    const other = await configureTelephonyAccount(staff, {
      label: 'Second parent',
      externalAccountId: sid('AC').slice(0, 34),
      credentialKind: 'auth_token',
      credentialIdentifier: null,
      secret: 'another-secret',
    });
    await asOperator(() => pg.query('select public.record_provider_account_verification($1, true)', [other]));
    await setDefaultProviderAccount(staff, { accountId: other });
    expect((await getProviderAccount(staff, accountId))?.isDefault).toBe(false);

    await provisionTelephonySubaccount(staff, { organizationId: tenant.organizationId });
    const [standing] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: tenant.organizationId });
    expect(standing.providerAccountId).toBe(accountId);

    // A new organization provisions under the new default.
    await provisionTelephonySubaccount(staff, { organizationId: second.organizationId });
    const [fresh] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: second.organizationId });
    expect(fresh.providerAccountId).toBe(other);

    await setDefaultProviderAccount(staff, { accountId });
  });

  it('refuses to make a disabled account the default, and stops provisioning under it', async () => {
    const [{ id: spare }] = (await pg.query(`select id from public.platform_provider_accounts where label = 'Second parent'`)).rows;
    await setProviderAccountStatus(staff, { accountId: spare, status: 'disabled' });
    await expect(setDefaultProviderAccount(staff, { accountId: spare })).rejects.toThrow(/active provider account/);
    // Disabling touched no binding.
    const [standing] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: second.organizationId });
    expect(standing.bindingStatus).toBe('active');
  });

  it('records a failure on the binding and resumes without duplicating what exists', async () => {
    const third = await newTenant('acct-failing');
    await beginProviderBinding(staff, { organizationId: third.organizationId, providerKey: 'twilio', providerAccountId: accountId });
    await setProviderBindingStatus(staff, { organizationId: third.organizationId, providerKey: 'twilio', status: 'failed', error: 'Twilio refused the request (403)' });
    const [failed] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: third.organizationId });
    expect(localHealth(failed)).toBe('failed');
    expect(failed.lastError).toContain('403');

    Object.assign(calls, { createSubaccount: 0 });
    await provisionTelephonySubaccount(staff, { organizationId: third.organizationId });
    await provisionTelephonySubaccount(staff, { organizationId: third.organizationId });
    expect(calls.createSubaccount).toBe(1);
  });
});

describe('reconciling with the provider', () => {
  it('reports a missing scope, a changed one and one GOLD does not know — and changes no status', async () => {
    const [ok] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: tenant.organizationId });
    const before = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: second.organizationId });
    // `second` lives under the disabled account, so it is not judged against this account's list.
    expect(before[0].providerAccountId).not.toBe(accountId);

    const stranger = { sid: sid('AC').slice(0, 34), friendlyName: 'someone-elses', status: 'active' };
    remoteSubaccounts = [{ sid: ok.externalAccountId!, friendlyName: `gold-org-${tenant.organizationId}`, status: 'active' }, stranger];

    const result = await reconcileTelephonyAccount(staff, { accountId });

    expect(result.findings.find((f) => f.organizationId === tenant.organizationId)?.health).toBe('in_sync');
    expect(result.unmanaged.map((row) => row.sid)).toContain(stranger.sid);
    const [after] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: tenant.organizationId });
    expect(after).toMatchObject({ reconciliationState: 'in_sync', bindingStatus: 'active' });
    expect(after.lastReconciledAt).not.toBeNull();
  });

  it('flags a binding whose subaccount the provider no longer lists, without touching it', async () => {
    remoteSubaccounts = [];
    const result = await reconcileTelephonyAccount(staff, { accountId });
    expect(result.findings.find((f) => f.organizationId === tenant.organizationId)?.health).toBe('remote_missing');

    const [after] = await listProviderOrganizationStandings(staff, { providerKey: 'twilio', organizationId: tenant.organizationId });
    expect(after).toMatchObject({ reconciliationState: 'remote_missing', bindingStatus: 'active', resourceCount: 3 });
  });

  it('refuses to reconcile an account that has not been verified', async () => {
    await configureTelephonyAccount(staff, { accountId, ...IDENTITY, secret: 'again' });
    await expect(reconcileTelephonyAccount(staff, { accountId })).rejects.toThrow(/Verify this account/);
  });

  it('records reconciliation through a door only staff can use', async () => {
    const write = await tenant.db.rpc('record_provider_binding_reconciliation', {
      p_organization_id: tenant.organizationId,
      p_provider_key: 'twilio',
      p_state: 'in_sync',
    });
    expect(write.error).not.toBeNull();
    const overview = await tenant.db.rpc('platform_provider_organization_overview', { p_provider_key: 'twilio' });
    expect(overview.error).not.toBeNull();
  });
});

describe('the comparison itself', () => {
  const row = (over: Partial<Parameters<typeof localHealth>[0]>) => ({
    organizationId: randomUUID(),
    organizationName: 'x',
    bindingId: randomUUID(),
    bindingStatus: 'active' as const,
    externalAccountId: 'ACx',
    providerAccountId: 'acct',
    lastVerifiedAt: null,
    lastError: null,
    reconciliationState: null,
    reconciliationDetail: null,
    lastReconciledAt: null,
    resourceCount: 0,
    boundAt: null,
    ...over,
  });
  const name = (id: string) => `gold-org-${id}`;

  it('separates every situation an operator meets', () => {
    const synced = row({});
    const renamed = row({ externalAccountId: 'ACr' });
    const gone = row({ externalAccountId: 'ACg' });
    const closed = row({ externalAccountId: 'ACc' });
    const none = row({ bindingId: null, bindingStatus: null, externalAccountId: null, providerAccountId: null });
    const failed = row({ bindingStatus: 'failed', lastError: 'boom' });
    const bootstrap = row({ providerAccountId: null, externalAccountId: 'ACb' });

    const { findings, unmanaged } = compareWithRemote({
      accountId: 'acct',
      expectedName: name,
      standings: [synced, renamed, gone, closed, none, failed, bootstrap],
      remote: [
        { sid: 'ACx', friendlyName: name(synced.organizationId), status: 'active' },
        { sid: 'ACr', friendlyName: 'renamed by hand', status: 'active' },
        { sid: 'ACc', friendlyName: name(closed.organizationId), status: 'closed' },
        { sid: 'ACb', friendlyName: name(bootstrap.organizationId), status: 'active' },
        { sid: 'ACu', friendlyName: 'unknown', status: 'active' },
      ],
    });

    const health = (r: { organizationId: string }) => findings.find((f) => f.organizationId === r.organizationId)?.health;
    expect(health(synced)).toBe('in_sync');
    expect(health(renamed)).toBe('remote_changed');
    expect(health(gone)).toBe('remote_missing');
    expect(health(closed)).toBe('remote_changed');
    expect(health(none)).toBe('not_provisioned');
    expect(health(failed)).toBe('failed');
    // Not this account's binding: known, never judged, never reported as somebody else's scope.
    expect(health(bootstrap)).toBe('unchecked');
    expect(unmanaged.map((r) => r.sid)).toEqual(['ACu']);
  });
});

describe('provider readiness', () => {
  const account = (over = {}) => ({
    id: 'a',
    providerKey: 'twilio',
    label: 'GOLD parent',
    externalAccountId: 'AC',
    credentialKind: 'api_key',
    credentialIdentifier: null,
    credentialSetAt: '2026-01-01',
    status: 'active' as const,
    verificationState: 'verified' as const,
    lastVerifiedAt: '2026-01-01',
    verificationError: null,
    isDefault: true,
    metadata: {},
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  it('says why, in every state', () => {
    expect(providerReadiness({ accounts: [account()], bootstrapConfigured: false, apiConfigured: true }).state).toBe('operational');
    expect(providerReadiness({ accounts: [], bootstrapConfigured: false, apiConfigured: true }).state).toBe('not_configured');
    expect(providerReadiness({ accounts: [], bootstrapConfigured: true, apiConfigured: false }).state).toBe('operational');

    const failed = providerReadiness({
      accounts: [account({ verificationState: 'failed', verificationError: '401' })],
      bootstrapConfigured: true,
      apiConfigured: true,
    });
    expect(failed.state).toBe('attention');
    expect(failed.reasons.join(' ')).toContain('401');

    expect(providerReadiness({ accounts: [account()], bootstrapConfigured: false, apiConfigured: false }).reasons.join(' ')).toContain('API');
  });
});
