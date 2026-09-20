import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  acceptInvitation,
  inviteMember,
  listPendingInvitations,
  revokeInvitation,
} from '@/lib/domain/tenancy/invitations';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Closing the gap `add_member_by_email`'s own migration comment named: inviting somebody who
 * does not have an account yet. Modeled on `portal.test.ts`'s shape, with the one difference
 * that actually matters — a portal link is view-only and stores its token in plaintext; this
 * grants a role, so only a hash is ever stored (20260915000003).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Actor = { db: SupabaseClient; userId: string; email: string };

async function signUp(label: string): Promise<Actor> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id, email };
}

let admin: Actor;
let stranger: Actor;
let organizationId: string;
let otherOrganizationId: string;
let roleId: string;

describe('organization invitations', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    admin = await signUp('inv-admin');
    stranger = await signUp('inv-stranger');

    organizationId = await foundBusiness({
      ownerEmail: admin.email,
      name: `Invitations ${randomUUID().slice(0, 6)}`,
      displayName: 'Admin',
      currency: 'EUR',
    });
    otherOrganizationId = await foundBusiness({
      ownerEmail: stranger.email,
      name: `Elsewhere ${randomUUID().slice(0, 6)}`,
      displayName: 'Stranger',
      currency: 'EUR',
    });

    const [founding] = await listRoles(admin.db, { organizationId });
    roleId = founding.id;
  });

  it('lets an admin invite into their own organization, and lists it as pending', async () => {
    const invitee = `invitee-${randomUUID().slice(0, 8)}@example.test`;
    const token = await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    expect(token).toHaveLength(64);

    const pending = await listPendingInvitations(admin.db, { organizationId });
    expect(pending.some((i) => i.email === invitee)).toBe(true);
  });

  it('never stores the plaintext token, only a hash', async () => {
    const invitee = `hash-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'organization_invitations'`,
      );
      const columns = rows.map((r) => r.column_name);
      expect(columns).toContain('token_hash');
      expect(columns).not.toContain('token');
    } finally {
      await pg.end();
    }
  });

  it('cannot invite into an organization the caller does not belong to', async () => {
    await expect(
      inviteMember(admin.db, {
        organizationId: otherOrganizationId,
        email: `nope-${randomUUID().slice(0, 8)}@example.test`,
        roleId,
      }),
    ).rejects.toMatchObject({ code: 'invitations.forbidden' });
  });

  it('refuses a caller without role.manage', async () => {
    // A member with no capabilities at all, added the ordinary way.
    const nobody = await signUp('inv-nobody');
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `insert into public.roles (organization_id, name, capabilities, created_by)
         values ($1, 'No powers', '{}', $2) returning id`,
        [organizationId, admin.userId],
      );
      await pg.query(
        `insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
         values ($1, $2, $3, 'Nobody', $4)`,
        [organizationId, nobody.userId, rows[0].id, admin.userId],
      );
    } finally {
      await pg.end();
    }

    await expect(
      inviteMember(nobody.db, {
        organizationId,
        email: `refused-${randomUUID().slice(0, 8)}@example.test`,
        roleId,
      }),
    ).rejects.toMatchObject({ code: 'invitations.forbidden' });
  });

  it('refuses a second invitation to the same address while one is still pending', async () => {
    const invitee = `dup-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });

    await expect(
      inviteMember(admin.db, { organizationId, email: invitee, roleId }),
    ).rejects.toMatchObject({ code: 'invitations.already_pending' });
  });

  it('re-invites the same address once the pending one has expired, with no manual revoke', async () => {
    const invitee = `expired-${randomUUID().slice(0, 8)}@example.test`;
    const first = await inviteMember(admin.db, { organizationId, email: invitee, roleId });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const hash = createHash('sha256').update(first).digest('hex');
      await pg.query(
        `update public.organization_invitations set expires_at = now() - interval '1 minute'
          where token_hash = $1`,
        [hash],
      );
    } finally {
      await pg.end();
    }

    const second = await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    expect(second).not.toBe(first);

    const pending = await listPendingInvitations(admin.db, { organizationId });
    expect(pending.filter((i) => i.email === invitee)).toHaveLength(1);
  });

  it('accepts an invitation, creating exactly one membership in the right organization', async () => {
    const joiner = await signUp('inv-joiner');
    const token = await inviteMember(admin.db, { organizationId, email: joiner.email, roleId });

    const acceptedOrgId = await acceptInvitation(joiner.db, { token, displayName: 'Joiner' });
    expect(acceptedOrgId).toBe(organizationId);

    const { data: memberships } = await joiner.db
      .from('memberships')
      .select('organization_id, role_id, display_name')
      .eq('user_id', joiner.userId);
    expect(memberships).toHaveLength(1);
    expect(memberships?.[0]).toMatchObject({
      organization_id: organizationId,
      role_id: roleId,
      display_name: 'Joiner',
    });
  });

  it('refuses acceptance by an account whose email does not match the invitation', async () => {
    const invitee = `mismatch-${randomUUID().slice(0, 8)}@example.test`;
    const token = await inviteMember(admin.db, { organizationId, email: invitee, roleId });

    // A different, genuinely signed-in person tries the same link.
    await expect(
      acceptInvitation(stranger.db, { token, displayName: 'Wrong Person' }),
    ).rejects.toMatchObject({ code: 'invitations.invalid' });
  });

  it('refuses a revoked invitation', async () => {
    const invitee = `revoked-${randomUUID().slice(0, 8)}@example.test`;
    const token = await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    await revokeInvitation(admin.db, { id: invitation.id });

    const joiner = await signUp('inv-revoked-joiner');
    // Re-created under the invitee's own email so the accepting account's email matches.
    const admin2 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin2.auth.admin.updateUserById(joiner.userId, { email: invitee });

    await expect(
      acceptInvitation(joiner.db, { token, displayName: 'Too Late' }),
    ).rejects.toMatchObject({ code: 'invitations.invalid' });
  });

  it('does not double-join on a retried accept, and does not crash', async () => {
    const joiner = await signUp('inv-retry-joiner');
    const token = await inviteMember(admin.db, { organizationId, email: joiner.email, roleId });

    await acceptInvitation(joiner.db, { token, displayName: 'First' });
    await expect(
      acceptInvitation(joiner.db, { token, displayName: 'Second' }),
    ).rejects.toMatchObject({ code: 'invitations.invalid' });

    const { data: memberships } = await joiner.db
      .from('memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', joiner.userId);
    expect(memberships).toHaveLength(1);
  });

  it('cannot be inserted with created_by spoofed to somebody else', async () => {
    const { error } = await admin.db.from('organization_invitations').insert({
      organization_id: organizationId,
      email: `spoof-${randomUUID().slice(0, 8)}@example.test`,
      role_id: roleId,
      token_hash: 'a'.repeat(64),
      created_by: stranger.userId,
    });
    expect(error).not.toBeNull();
  });

  it('cannot be un-revoked or re-revoked through any path, direct or otherwise', async () => {
    const invitee = `monotonic-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    await revokeInvitation(admin.db, { id: invitation.id });

    // No column grant survives to attempt this through — a direct update, even to null, is a
    // missing privilege, not a policy decline.
    const direct = await admin.db
      .from('organization_invitations')
      .update({ revoked_at: null })
      .eq('id', invitation.id);
    expect(direct.error).not.toBeNull();

    // Revoking an already-revoked invitation a second time is a safe no-op, not an error and
    // not a way to disturb the row further.
    await expect(revokeInvitation(admin.db, { id: invitation.id })).resolves.toBeUndefined();

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query(
        'select revoked_at from public.organization_invitations where id = $1',
        [invitation.id],
      );
      expect(rows[0].revoked_at).not.toBeNull();
    } finally {
      await pg.end();
    }
  });

  it('cannot be revoked once accepted', async () => {
    const joiner = await signUp('inv-accepted-then-revoke');
    const token = await inviteMember(admin.db, { organizationId, email: joiner.email, roleId });
    await acceptInvitation(joiner.db, { token, displayName: 'Already In' });

    const pg = new Client(CONNECTION);
    await pg.connect();
    let id: string;
    try {
      const { rows } = await pg.query(
        'select id from public.organization_invitations where organization_id = $1 and email = $2',
        [organizationId, joiner.email],
      );
      id = rows[0].id;
    } finally {
      await pg.end();
    }

    await revokeInvitation(admin.db, { id });

    const pg2 = new Client(CONNECTION);
    await pg2.connect();
    try {
      const { rows } = await pg2.query(
        'select revoked_at, accepted_at from public.organization_invitations where id = $1',
        [id],
      );
      expect(rows[0].revoked_at).toBeNull();
      expect(rows[0].accepted_at).not.toBeNull();
    } finally {
      await pg2.end();
    }
  });

  it('does not show an expired invitation as pending', async () => {
    const invitee = `stale-${randomUUID().slice(0, 8)}@example.test`;
    const token = await inviteMember(admin.db, { organizationId, email: invitee, roleId });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const hash = createHash('sha256').update(token).digest('hex');
      await pg.query(
        `update public.organization_invitations set expires_at = now() - interval '1 minute'
          where token_hash = $1`,
        [hash],
      );
    } finally {
      await pg.end();
    }

    const pending = await listPendingInvitations(admin.db, { organizationId });
    expect(pending.some((i) => i.email === invitee)).toBe(false);
  });

  it('refuses acceptance from an anonymous Supabase session, even with no matching email to fail on', async () => {
    const invitee = `anon-${randomUUID().slice(0, 8)}@example.test`;
    const token = await inviteMember(admin.db, { organizationId, email: invitee, roleId });

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await anon.auth.signInAnonymously();
    if (signInError) throw signInError;

    await expect(
      acceptInvitation(anon, { token, displayName: 'Anonymous' }),
    ).rejects.toMatchObject({ code: 'invitations.invalid' });
  });

  it('refuses to invite someone who already has an account and is already a member here', async () => {
    const already = await signUp('inv-already-member');
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      await pg.query(
        `insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
         values ($1, $2, $3, 'Already Here', $4)`,
        [organizationId, already.userId, roleId, admin.userId],
      );
    } finally {
      await pg.end();
    }

    await expect(
      inviteMember(admin.db, { organizationId, email: already.email, roleId }),
    ).rejects.toMatchObject({ code: 'invitations.already_member' });
  });

  it('never changes an existing member’s role through invite creation or acceptance', async () => {
    const pg = new Client(CONNECTION);
    await pg.connect();
    let elevatedRoleId: string;
    try {
      const { rows } = await pg.query(
        `insert into public.roles (organization_id, name, capabilities, created_by)
         values ($1, 'Elevated', $2, $3) returning id`,
        [organizationId, ['role.manage'], admin.userId],
      );
      elevatedRoleId = rows[0].id;
    } finally {
      await pg.end();
    }

    const already = await signUp('inv-role-guard');
    const pg2 = new Client(CONNECTION);
    await pg2.connect();
    try {
      await pg2.query(
        `insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
         values ($1, $2, $3, 'Original Role', $4)`,
        [organizationId, already.userId, roleId, admin.userId],
      );
    } finally {
      await pg2.end();
    }

    // Inviting them into a different role is refused outright, not silently applied.
    await expect(
      inviteMember(admin.db, { organizationId, email: already.email, roleId: elevatedRoleId }),
    ).rejects.toMatchObject({ code: 'invitations.already_member' });

    const pg3 = new Client(CONNECTION);
    await pg3.connect();
    try {
      const { rows } = await pg3.query(
        'select role_id from public.memberships where organization_id = $1 and user_id = $2',
        [organizationId, already.userId],
      );
      expect(rows[0].role_id).toBe(roleId);
    } finally {
      await pg3.end();
    }
  });

  it('refuses acceptance, without a false accepted state, when membership arrived through another path first', async () => {
    const joiner = await signUp('inv-race-joiner');
    const token = await inviteMember(admin.db, { organizationId, email: joiner.email, roleId });

    // Simulates a second admin adding them directly (or any other path to membership) between
    // the invitation being sent and being accepted.
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      await pg.query(
        `insert into public.memberships (organization_id, user_id, role_id, display_name, created_by)
         values ($1, $2, $3, 'Added Another Way', $4)`,
        [organizationId, joiner.userId, roleId, admin.userId],
      );
    } finally {
      await pg.end();
    }

    await expect(
      acceptInvitation(joiner.db, { token, displayName: 'Too Late' }),
    ).rejects.toMatchObject({ code: 'invitations.already_member' });

    const pg2 = new Client(CONNECTION);
    await pg2.connect();
    try {
      const { rows } = await pg2.query(
        'select accepted_at from public.organization_invitations where organization_id = $1 and email = $2',
        [organizationId, joiner.email],
      );
      expect(rows[0].accepted_at).toBeNull();

      const memberships = await pg2.query(
        'select count(*)::int as n from public.memberships where organization_id = $1 and user_id = $2',
        [organizationId, joiner.userId],
      );
      expect(memberships.rows[0].n).toBe(1);
    } finally {
      await pg2.end();
    }
  });

  it('records who revoked an invitation, and does not double-record a repeat or a too-late revoke', async () => {
    const invitee = `audit-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    await revokeInvitation(admin.db, { id: invitation.id });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `select actor_id, payload from public.events
          where organization_id = $1 and action = 'organization.member_invitation_revoked'
            and payload ->> 'invitation_id' = $2`,
        [organizationId, invitation.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(admin.userId);
      expect(rows[0].payload.email).toBe(invitee);
      expect(rows[0].payload.role_id).toBe(roleId);
    } finally {
      await pg.end();
    }

    // A second revoke of the same (already-revoked) invitation is a safe no-op per
    // 20260915000005 — and must not add a second event for a revocation that did not happen.
    await revokeInvitation(admin.db, { id: invitation.id });

    const pg2 = new Client(CONNECTION);
    await pg2.connect();
    try {
      const { rows } = await pg2.query(
        `select count(*)::int as n from public.events
          where organization_id = $1 and action = 'organization.member_invitation_revoked'
            and payload ->> 'invitation_id' = $2`,
        [organizationId, invitation.id],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await pg2.end();
    }
  });
});
