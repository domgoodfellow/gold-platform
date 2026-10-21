import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

/**
 * Removes exactly what one isolated browser run recorded in its `fixtures.json` — its businesses,
 * accounts and plans — and nothing else. Never disables triggers or foreign-key enforcement: rows
 * whose foreign key to a business does not cascade (a campaign, a portal offer) are found from the
 * catalogue and deleted children-first, scoped to the run's own businesses, inside one transaction.
 * Anything that cannot be removed lawfully (a published website revision is immutable by design)
 * fails the run with the reason instead of being forced, and a final check proves nothing the run
 * owned remains.
 */

export type RunManifest = { organizationIds: string[]; userIds: string[]; planKeys?: string[] };

function local(value: string) {
  if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error(`Isolated fixtures are local only, not ${value}.`);
}

/**
 * Tables holding this run's rows that keep its businesses from being deleted: reachable from
 * `organizations` through foreign keys that do not cascade, business-scoped, and non-empty for the
 * run. Ordered so each is emptied before any table it depends on; a cycle among them is refused.
 */
async function blockingTables(pg: Client, organizationIds: string[]): Promise<string[]> {
  const { rows: edges } = await pg.query<{ child: string; parent: string }>(`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c
    where c.contype = 'f' and c.confdeltype in ('a', 'r') and c.conrelid <> c.confrelid`);
  const reachable = new Set<string>();
  const add = (parent: string) => {
    for (const edge of edges) if (edge.parent === parent && !reachable.has(edge.child)) { reachable.add(edge.child); add(edge.child); }
  };
  add('organizations');
  const { rows: scoped } = await pg.query<{ name: string }>(`
    select c.oid::regclass::text as name from pg_class c join pg_attribute a on a.attrelid = c.oid
    where a.attname = 'organization_id' and not a.attisdropped and c.relkind = 'r'`);
  const holding = new Set<string>();
  for (const { name } of scoped) {
    if (!reachable.has(name)) continue;
    const { rows } = await pg.query(`select 1 from ${name} where organization_id = any($1::uuid[]) limit 1`, [organizationIds]);
    if (rows.length) holding.add(name);
  }
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (table: string) => {
    if (ordered.includes(table)) return;
    if (visiting.has(table)) throw new Error(`Cleanup order is cyclic at ${table}; refusing to guess.`);
    visiting.add(table);
    for (const edge of edges) if (edge.parent === table && holding.has(edge.child)) visit(edge.child);
    visiting.delete(table);
    ordered.push(table);
  };
  for (const table of [...holding].sort()) visit(table);
  return ordered;
}

export async function cleanupRun(manifest: RunManifest, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const connection = env.SUPABASE_DB_URL!;
  const url = env.SUPABASE_URL!;
  local(connection); local(url);
  const organizationIds = manifest.organizationIds ?? [];
  const userIds = manifest.userIds ?? [];
  const planKeys = manifest.planKeys ?? [];
  const pg = new Client(connection);
  await pg.connect();
  try {
    await pg.query('begin');
    try {
      await pg.query('delete from platform_staff where user_id = any($1::uuid[])', [userIds]);
      // A blocking table that is not business-scoped cannot be cleaned by business; the delete below then fails and names it.
      for (const table of await blockingTables(pg, organizationIds)) {
        await pg.query(`delete from ${table} where organization_id = any($1::uuid[])`, [organizationIds]);
      }
      await pg.query('delete from organizations where id = any($1::uuid[])', [organizationIds]);
      await pg.query('delete from platform_plans where key = any($1::text[])', [planKeys]);
      await pg.query('commit');
    } catch (error) {
      await pg.query('rollback');
      throw new Error(`Isolated cleanup could not remove this run's businesses ${organizationIds.join(', ')}: ${(error as Error).message}`);
    }
  } finally {
    await pg.end();
  }

  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const id of userIds) {
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error && !/not found/i.test(removed.error.message)) throw new Error(`Isolated cleanup could not remove account ${id}: ${removed.error.message}`);
  }
  await assertRemoved(manifest, connection);
}

/** Proof, not hope: none of the run's businesses, accounts or plans may remain. */
export async function assertRemoved(manifest: RunManifest, connection: string): Promise<void> {
  const pg = new Client(connection);
  await pg.connect();
  try {
    const { rows } = await pg.query<{ organizations: number; users: number; plans: number }>(`
      select (select count(*)::int from organizations where id = any($1::uuid[])) as organizations,
             (select count(*)::int from auth.users where id = any($2::uuid[])) as users,
             (select count(*)::int from platform_plans where key = any($3::text[])) as plans`,
      [manifest.organizationIds ?? [], manifest.userIds ?? [], manifest.planKeys ?? []]);
    const left = rows[0];
    if (left.organizations || left.users || left.plans) throw new Error(`Isolated cleanup left test-owned records: ${JSON.stringify(left)}.`);
  } finally {
    await pg.end();
  }
}

export function readManifest(directory: string): RunManifest | null {
  const file = path.join(directory, 'fixtures.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as RunManifest : null;
}

function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Runs that were killed before their teardown leave their manifest behind. Their folder is named
 * by the process id that wrote it; only a folder whose process is gone is cleaned, so a run still
 * in progress elsewhere is never touched. Returns the folders cleaned.
 */
export async function cleanupAbandonedRuns(root: string, current: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const cleaned: string[] = [];
  for (const name of readdirSync(root)) {
    const directory = path.join(root, name);
    if (path.resolve(directory) === path.resolve(current) || !/^\d+$/.test(name) || running(Number(name))) continue;
    const manifest = readManifest(directory);
    if (manifest) await cleanupRun(manifest);
    rmSync(directory, { recursive: true, force: true });
    cleaned.push(name);
  }
  return cleaned;
}
