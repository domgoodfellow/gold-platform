import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatformStaff } from '@/tests/support/founding';

/**
 * `platform_ai_runtime_assignments`: who may see and change which Provider Service, Provider
 * Account and model answers an AI capability. The table itself carries no select grant to any
 * role, staff included -- `platform_ai_runtime_assignment_overview` and
 * `record_ai_runtime_assignment` are the only two doors, and `resolve_ai_runtime_assignment` is a
 * third, reachable by the `provider_operator` machine role alone (the same role
 * `read_provider_account_credential` already trusts).
 *
 * Real Postgres, real RLS: every refusal below is the database's own, not this suite's opinion.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pg: Client;
let staff: SupabaseClient;
let tenant: SupabaseClient;

async function signedInStranger(label: string): Promise<SupabaseClient> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return db;
}

/** Acts as the one machine role that may resolve an assignment. */
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
  await pg.query('delete from public.platform_ai_runtime_assignments');
  await pg.query(`delete from public.platform_provider_accounts where label like 'AI runtime test%'`);
}

async function newAccount(input: { providerKey: string; label: string; credentialed: boolean; status?: 'active' | 'disabled' }) {
  const { data: id, error } = await staff.rpc('record_provider_account', {
    p_provider_key: input.providerKey,
    p_label: input.label,
    p_external_account_id: '',
    p_credential_kind: 'api_key',
    p_credential_identifier: '',
  });
  if (error) throw error;
  if (input.credentialed) {
    const stored = await staff.rpc('store_provider_account_credential', { p_account_id: id, p_secret: `secret-${randomUUID()}` });
    if (stored.error) throw stored.error;
  }
  if (input.status === 'disabled') {
    const disabled = await staff.rpc('set_provider_account_status', { p_account_id: id, p_status: 'disabled' });
    if (disabled.error) throw disabled.error;
  }
  return id as string;
}

async function serviceId(providerKey: string, key: string): Promise<string> {
  const { data, error } = await staff.from('platform_provider_services').select('id').eq('provider_key', providerKey).eq('key', key).single();
  if (error) throw error;
  return data.id as string;
}

let openaiResponses: string;
let googleGemini: string;
let openaiPlanned: string;
let openaiAccount: string;
let googleAccount: string;
let uncredentialedAccount: string;
let disabledAccount: string;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
  tenant = await signedInStranger('ai-runtime-tenant');
  await wipe();

  openaiResponses = await serviceId('openai', 'responses');
  googleGemini = await serviceId('google', 'gemini_interactions');
  openaiPlanned = await serviceId('openai', 'realtime'); // seeded planned, never implemented this slice

  openaiAccount = await newAccount({ providerKey: 'openai', label: 'AI runtime test — OpenAI', credentialed: true });
  googleAccount = await newAccount({ providerKey: 'google', label: 'AI runtime test — Google', credentialed: true });
  uncredentialedAccount = await newAccount({ providerKey: 'openai', label: 'AI runtime test — no credential', credentialed: false });
  disabledAccount = await newAccount({ providerKey: 'openai', label: 'AI runtime test — disabled', credentialed: true, status: 'disabled' });
}, 60_000);

afterAll(async () => {
  await wipe();
  await pg?.end();
});

describe('the table itself has no select grant, staff included', () => {
  it('refuses a direct select to an ordinary tenant', async () => {
    const result = await tenant.from('platform_ai_runtime_assignments').select('*');
    expect(result.error?.code).toBe('42501');
  });

  it('refuses a direct select to platform staff too — the overview function is the only read', async () => {
    const result = await staff.from('platform_ai_runtime_assignments').select('*');
    expect(result.error?.code).toBe('42501');
  });

  it('gives authenticated and anon no select/insert/update/delete — REFERENCES/TRIGGER are Postgres defaults, not this table\'s own grant', async () => {
    const { rows } = await pg.query(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_name = 'platform_ai_runtime_assignments'
          and grantee in ('authenticated', 'anon')
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
    );
    expect(rows).toEqual([]);
  });
});

describe('who may write an assignment', () => {
  it('refuses an ordinary tenant', async () => {
    const result = await tenant.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: openaiAccount,
      p_model: 'gpt-test',
    });
    expect(result.error?.code).toBe('42501');
  });

  it('lets platform staff assign a capability, readable back through the overview', async () => {
    const write = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: openaiAccount,
      p_model: 'gpt-test',
    });
    expect(write.error).toBeNull();

    const { data, error } = await staff.rpc('platform_ai_runtime_assignment_overview');
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>).find((r) => r.capability === 'operator_assistant');
    expect(row).toMatchObject({
      provider_key: 'openai',
      provider_service_key: 'responses',
      provider_account_id: openaiAccount,
      model: 'gpt-test',
    });
  });

  it('reassigning the same capability replaces it rather than adding a second row', async () => {
    await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: googleGemini,
      p_provider_account_id: googleAccount,
      p_model: 'gemini-test',
    });

    const { data } = await staff.rpc('platform_ai_runtime_assignment_overview');
    const rows = (data as Array<Record<string, unknown>>).filter((r) => r.capability === 'operator_assistant');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider_key: 'google', model: 'gemini-test' });
  });
});

describe('an ordinary tenant cannot read the staff overview either', () => {
  it('refuses platform_ai_runtime_assignment_overview', async () => {
    const result = await tenant.rpc('platform_ai_runtime_assignment_overview');
    expect(result.error?.code).toBe('42501');
  });
});

describe('resolve_ai_runtime_assignment is reachable by provider_operator alone', () => {
  it('refuses platform staff', async () => {
    const result = await staff.rpc('resolve_ai_runtime_assignment', { p_capability: 'operator_assistant' });
    expect(result.error?.code).toBe('42501');
  });

  it('refuses an ordinary tenant', async () => {
    const result = await tenant.rpc('resolve_ai_runtime_assignment', { p_capability: 'operator_assistant' });
    expect(result.error?.code).toBe('42501');
  });

  it('is granted execute on the function to provider_operator alone', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', 'public.resolve_ai_runtime_assignment(text)', 'execute') as authenticated,
              has_function_privilege('anon', 'public.resolve_ai_runtime_assignment(text)', 'execute') as anon,
              has_function_privilege('provider_operator', 'public.resolve_ai_runtime_assignment(text)', 'execute') as operator`,
    );
    expect(rows[0]).toEqual({ authenticated: false, anon: false, operator: true });
  });

  it('answers for the machine role, and nothing for an unassigned capability', async () => {
    await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'public_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: openaiAccount,
      p_model: 'gpt-public-test',
    });

    const resolved = await asOperator(() =>
      pg.query('select * from public.resolve_ai_runtime_assignment($1)', ['public_assistant']),
    );
    expect(resolved.rows[0]).toMatchObject({
      provider_key: 'openai',
      provider_service_key: 'responses',
      provider_account_id: openaiAccount,
      model: 'gpt-public-test',
    });

    const unassigned = await asOperator(() =>
      pg.query('select * from public.resolve_ai_runtime_assignment($1)', ['a_capability_nobody_assigned']),
    );
    expect(unassigned.rows).toEqual([]);
  });
});

describe('validation refuses before a bad assignment is ever stored', () => {
  it('refuses an unknown capability', async () => {
    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'nonsense_capability',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: openaiAccount,
      p_model: 'gpt-test',
    });
    expect(result.error?.message).toMatch(/unknown AI capability/);
  });

  it('refuses a planned, unimplemented service', async () => {
    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiPlanned,
      p_provider_account_id: openaiAccount,
      p_model: 'gpt-test',
    });
    expect(result.error?.message).toMatch(/no runtime implementation/);
  });

  it('refuses a provider/account mismatch', async () => {
    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: googleAccount,
      p_model: 'gpt-test',
    });
    expect(result.error?.message).toMatch(/different provider/);
  });

  it('refuses a disabled account', async () => {
    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: disabledAccount,
      p_model: 'gpt-test',
    });
    expect(result.error?.message).toMatch(/not active/);
  });

  it('refuses an account with no credential stored', async () => {
    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: uncredentialedAccount,
      p_model: 'gpt-test',
    });
    expect(result.error?.message).toMatch(/no credential stored/);
  });

  it('refuses a blank model', async () => {
    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: openaiAccount,
      p_model: '   ',
    });
    expect(result.error?.message).toMatch(/model is required/);
  });
});

describe('the deliberate policy: credentialed and active is enough, verification is not required', () => {
  it('accepts an assignment to an account that has never been verified', async () => {
    const { data: verificationState } = await staff.from('platform_provider_accounts').select('verification_state').eq('id', openaiAccount).single();
    // The account this whole suite has been assigning throughout was never verified — proving
    // the policy by using exactly the state every account above was already in, rather than a
    // special-cased fixture built only to pass this one test.
    expect(verificationState?.verification_state).toBe('unverified');

    const result = await staff.rpc('record_ai_runtime_assignment', {
      p_capability: 'operator_assistant',
      p_provider_service_id: openaiResponses,
      p_provider_account_id: openaiAccount,
      p_model: 'gpt-test-unverified',
    });
    expect(result.error).toBeNull();
  });
});
