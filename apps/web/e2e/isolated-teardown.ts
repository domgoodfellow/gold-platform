import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

/**
 * Removes exactly what `isolated-setup.ts` recorded for this run — its business and its two
 * accounts — and the run's context and signed-in states. Nothing else is touched.
 */
export default async function isolatedTeardown(): Promise<void> {
  loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
  const directory = process.env.E2E_FIXTURE_DIR;
  if (!directory) return;
  const manifest = path.join(directory, 'fixtures.json');
  if (!existsSync(manifest)) return;
  const created = JSON.parse(readFileSync(manifest, 'utf8')) as { organizationIds: string[]; userIds: string[]; planKeys?: string[] };
  const connection = process.env.SUPABASE_DB_URL!;
  const url = process.env.SUPABASE_URL!;
  if (![connection, url].every((value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Isolated fixtures are local only.');
  const pg = new Client(connection);
  await pg.connect();
  try {
    await pg.query('delete from platform_staff where user_id=any($1::uuid[])', [created.userIds]);
    await pg.query('delete from organizations where id=any($1::uuid[])', [created.organizationIds]);
    await pg.query('delete from platform_plans where key=any($1::text[])', [created.planKeys ?? []]);
  } finally {
    await pg.end();
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const id of created.userIds) {
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error) throw removed.error;
  }
  rmSync(directory, { recursive: true, force: true });
}
