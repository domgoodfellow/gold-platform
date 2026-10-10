import { Client } from 'pg';
import { loadDemoContext } from './helpers';

/**
 * The demo organization's two members have fixed roles (Sanne: Admin, Joris: Werfmedewerker) and
 * persist between runs. Specs that reassign roles restore them themselves on success; this runs
 * after them regardless, so a failed assertion cannot leave the owner demoted and silently break
 * every later spec. Test fixture repair over a direct connection — never a user action.
 */
export async function restoreDemoRoles(): Promise<void> {
  const { organizationId } = loadDemoContext();
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await pg.connect();
  try {
    const role = async (name: string) => (await pg.query('select id from public.roles where organization_id=$1 and name=$2', [organizationId, name])).rows[0]?.id as string | undefined;
    const admin = await role('Admin');
    const hand = await role('Werfmedewerker');
    if (!admin || !hand) return;
    await pg.query(`update public.memberships m set role_id=$3 from auth.users u where u.id=m.user_id and m.organization_id=$1 and u.email=$2`, [organizationId, 'sanne@grachtwerk.test', admin]);
    await pg.query(`update public.memberships m set role_id=$3 from auth.users u where u.id=m.user_id and m.organization_id=$1 and u.email=$2`, [organizationId, 'joris@grachtwerk.test', hand]);
  } finally {
    await pg.end();
  }
}
