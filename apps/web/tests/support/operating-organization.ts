import type { Client } from 'pg';

/**
 * GildOps' operating organization is one value per database, so a suite that designates its own
 * first sets aside whatever was there and puts it back afterwards. Database suites run one file at
 * a time (`fileParallelism: false`), which is what makes this safe. The value is cleared before it
 * is restored because the identity refuses to move from one organization to another in one step.
 */
export async function setAsideOperatingOrganization(pg: Client): Promise<() => Promise<void>> {
  const { rows } = await pg.query<{ id: string | null }>(
    'select operating_organization_id as id from public.platform_settings where singleton',
  );
  const previous = rows[0]?.id ?? null;
  await pg.query('update public.platform_settings set operating_organization_id = null where singleton');

  return async () => {
    await pg.query('update public.platform_settings set operating_organization_id = null where singleton');
    await pg.query('update public.platform_settings set operating_organization_id = $1 where singleton', [previous]);
  };
}

export async function operatingOrganizationId(pg: Client): Promise<string | null> {
  const { rows } = await pg.query<{ id: string | null }>(
    'select operating_organization_id as id from public.platform_settings where singleton',
  );
  return rows[0]?.id ?? null;
}
