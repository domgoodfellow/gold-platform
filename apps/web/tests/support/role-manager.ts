import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import type { Db } from '@/lib/db/types';
import { addMember, listMembers } from '@/lib/domain/tenancy/members';
import { assignRole } from '@/lib/domain/tenancy/roles';

/**
 * Keep an authorized peer while a fixture temporarily narrows its owner's role. Restoring access
 * still goes through the real command as that peer; a demoted owner cannot promote themselves.
 * Remove its membership and soft-delete its generated account afterwards, retaining the audit actor.
 */
export async function retainRoleManager(db: Db, input: { organizationId: string; membershipId: string }): Promise<() => Promise<void>> {
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Role fixtures are local only.');
  const connection = process.env.SUPABASE_DB_URL;
  if (!connection || !['localhost', '127.0.0.1'].includes(new URL(connection).hostname)) throw new Error('Role fixture cleanup needs local PostgreSQL.');
  const member = (await listMembers(db, input)).find((row) => row.id === input.membershipId);
  if (!member) throw new Error('Fixture membership is missing.');
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const email = `retained-manager-${randomUUID()}@example.test`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const peer = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
  try {
    await addMember(db, { organizationId: input.organizationId, email, roleId: member.role.id, displayName: 'Retained fixture manager' });
    const login = await peer.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  } catch (error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    throw error;
  }
  return async () => {
    try {
      await assignRole(peer, { membershipId: input.membershipId, roleId: member.role.id });
    } finally {
      const pg = new Client({ connectionString: connection });
      await pg.connect();
      try {
        await pg.query('delete from public.memberships where organization_id=$1 and user_id=$2', [input.organizationId, created.data.user.id]);
      } finally {
        await pg.end();
      }
      const removed = await admin.auth.admin.deleteUser(created.data.user.id, true);
      if (removed.error) throw removed.error;
    }
  };
}
