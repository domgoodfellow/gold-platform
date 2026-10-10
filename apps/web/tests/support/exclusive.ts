import type { Client } from 'pg';

/**
 * Some suites assert on tables every tenant shares (the platform's provider accounts and rates):
 * "the first account becomes the default", "nothing else exists". Vitest runs files in parallel,
 * so two such suites would see each other's rows. A session-level advisory lock, held from a
 * suite's `beforeAll` to its `afterAll`, queues them without touching the runner's configuration or
 * any data. The key is one constant for the group.
 */
const PLATFORM_PROVIDER_TABLES = 7_040_301;

export async function holdPlatformProviderTables(pg: Client): Promise<void> {
  await pg.query('select pg_advisory_lock($1)', [PLATFORM_PROVIDER_TABLES]);
}

export async function releasePlatformProviderTables(pg: Client): Promise<void> {
  await pg.query('select pg_advisory_unlock($1)', [PLATFORM_PROVIDER_TABLES]);
}
