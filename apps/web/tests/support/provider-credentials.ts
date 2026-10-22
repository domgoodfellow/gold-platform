import type { Client } from 'pg';

function requireLocal(pg: Client) {
  if (!['localhost', '127.0.0.1', '::1'].includes(pg.host)) {
    throw new Error('Provider credential fixtures require a loopback database.');
  }
}

/** Privileged setup for the local fake email transport; never used by application code. */
export async function storeFixtureProviderCredential(pg: Client, accountId: string, value: string) {
  requireLocal(pg);
  await pg.query("update platform_provider_accounts set secret_id = vault.create_secret($2, 'fixture:' || $1::text) where id=$1", [accountId, value]);
}

export async function removeFixtureProviderAccounts(pg: Client, accountIds: string[]) {
  requireLocal(pg);
  await pg.query('begin');
  try {
    const secrets = (await pg.query('select secret_id from platform_provider_accounts where id=any($1::uuid[]) and secret_id is not null', [accountIds])).rows.map(row => row.secret_id);
    await pg.query('delete from platform_provider_accounts where id=any($1::uuid[])', [accountIds]);
    if (secrets.length) await pg.query('delete from vault.secrets where id=any($1::uuid[])', [secrets]);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}
