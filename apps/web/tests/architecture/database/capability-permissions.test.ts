import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import library from '@/lib/contracts/integrations/library.generated.json';

/**
 * Every read a connected app offers an agent must say which permission the person asking needs.
 *
 * A capability with no row is refused (`permission_unmapped`), which is the safe failure but a silent
 * one: a connector author who declares a capability and forgets the row ships something that never
 * works. This holds the two lists together, and holds the mapped permissions to the real vocabulary.
 */

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CONNECTORS = join(fileURLToPath(new URL('../../../../api', import.meta.url)), 'app', 'connectors');

function declaredCapabilities(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(CONNECTORS)) {
    if (!file.endsWith('.py') || file === 'base.py') continue;
    for (const match of readFileSync(join(CONNECTORS, file), 'utf8').matchAll(/Capability\(\s*"([a-z_.0-9]+)"/g)) keys.add(match[1]);
  }
  for (const app of library.applications) {
    for (const action of app.actions) if (action.executable) keys.add(action.capability);
  }
  return [...keys].sort();
}

describe('what a member must hold for the agent to read on their behalf', () => {
  let pg: Client;
  beforeAll(async () => {
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.end();
  });

  it('has a row for every capability a connector declares, and none for one that does not exist', async () => {
    const declared = declaredCapabilities();
    expect(declared.length).toBeGreaterThan(10);
    const { rows } = await pg.query('select capability_key from public.integration_capability_permissions order by 1');
    expect(rows.map((row) => row.capability_key)).toEqual(declared);
  });

  it('names only permissions a role can actually hold', async () => {
    const { rows } = await pg.query('select distinct required_permission from public.integration_capability_permissions');
    for (const row of rows) expect(ALL_CAPABILITIES, row.required_permission).toContain(row.required_permission);
  });

  it('is readable by a signed-in role and writable by none', async () => {
    const { rows } = await pg.query(
      `select has_table_privilege('authenticated', 'public.integration_capability_permissions', 'select') as read,
              has_table_privilege('authenticated', 'public.integration_capability_permissions', 'insert') as insert,
              has_table_privilege('authenticated', 'public.integration_capability_permissions', 'update') as update,
              has_table_privilege('authenticated', 'public.integration_capability_permissions', 'delete') as remove,
              has_table_privilege('anon', 'public.integration_capability_permissions', 'select') as anon`,
    );
    expect(rows[0]).toEqual({ read: true, insert: false, update: false, remove: false, anon: false });
  });
});
