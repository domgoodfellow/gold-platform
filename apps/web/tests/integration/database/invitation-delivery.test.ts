import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptInvitation, inviteMember, listPendingInvitations, reissueInvitation, revokeInvitation } from '@/lib/domain/tenancy/invitations';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Resend's reissue, and an invitation's delivery as a fact distinct from its lifecycle.
 *
 * What is provable here, against real Postgres and real RLS: reissuing rotates the token so the
 * old link stops validating immediately; a business never reaches another's delivery rows; only
 * `provider_operator` may record a send result and only `invitation_email_webhook` may record a
 * provider callback, and the callback derives its own organization and invitation from the
 * provider's own message id rather than trusting either. `app.services.platform_email` and
 * `app.providers.resend.webhook` are proved offline, in `apps/api/tests`.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pg: Client;

type Actor = { db: SupabaseClient; userId: string; email: string };

async function signUp(label: string): Promise<Actor> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: created.user.id, email };
}

/** Acts as the one machine role that may record the immediate result of a send. */
async function asProviderOperator<T>(run: () => Promise<T>): Promise<T> {
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

/** Acts as the one machine role a Resend callback arrives as. */
async function asInvitationEmailWebhook<T>(run: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role invitation_email_webhook');
    const result = await run();
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

let admin: Actor;
let stranger: Actor;
let organizationId: string;
let otherOrganizationId: string;
let roleId: string;

describe('invitation reissue and delivery', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    pg = new Client(CONNECTION);
    await pg.connect();

    admin = await signUp('deliv-admin');
    stranger = await signUp('deliv-stranger');

    organizationId = await foundBusiness({ ownerEmail: admin.email, name: `Delivery ${randomUUID().slice(0, 6)}`, currency: 'EUR' });
    otherOrganizationId = await foundBusiness({ ownerEmail: stranger.email, name: `Elsewhere ${randomUUID().slice(0, 6)}`, currency: 'EUR' });

    const [founding] = await listRoles(admin.db, { organizationId });
    roleId = founding.id;
  });

  afterAll(async () => {
    await pg.end();
  });

  // --- reissue --------------------------------------------------------------------------------

  it('rotates the token: the old link stops validating and the new one works', async () => {
    const invitee = `reissue-${randomUUID().slice(0, 8)}@example.test`;
    const first = await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    const second = await reissueInvitation(admin.db, { id: invitation.id });
    expect(second).not.toBe(first);

    const joiner = await signUp('deliv-joiner');
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await adminClient.auth.admin.updateUserById(joiner.userId, { email: invitee });

    await expect(acceptInvitation(joiner.db, { token: first, displayName: 'Too Late' })).rejects.toMatchObject({ code: 'invitations.invalid' });
    await expect(acceptInvitation(joiner.db, { token: second, displayName: 'Joiner' })).resolves.toBe(organizationId);
  });

  it('resets the expiry window to a fresh seven days', async () => {
    const invitee = `reissue-expiry-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    await pg.query(`update public.organization_invitations set expires_at = now() + interval '10 minutes' where id = $1`, [invitation.id]);
    await reissueInvitation(admin.db, { id: invitation.id });

    const { rows } = await pg.query('select expires_at from public.organization_invitations where id = $1', [invitation.id]);
    const daysOut = (new Date(rows[0].expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(daysOut).toBeGreaterThan(6.9);
  });

  it('two overlapping reissues leave exactly one token valid, never both', async () => {
    const invitee = `concurrent-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    const [tokenA, tokenB] = await Promise.all([
      reissueInvitation(admin.db, { id: invitation.id }),
      reissueInvitation(admin.db, { id: invitation.id }),
    ]);
    expect(tokenA).not.toBe(tokenB);

    const { createHash } = await import('node:crypto');
    const { rows } = await pg.query('select token_hash from public.organization_invitations where id = $1', [invitation.id]);
    const storedHash = rows[0].token_hash as string;
    const hashA = createHash('sha256').update(tokenA).digest('hex');
    const hashB = createHash('sha256').update(tokenB).digest('hex');

    // A single column cannot hold two hashes: whichever call committed last is the only one
    // stored, and it is always exactly one of the two — never neither, never some third value.
    expect([hashA, hashB]).toContain(storedHash);
    expect(hashA === storedHash).not.toBe(hashB === storedHash);
  });

  it('cannot be resent by somebody without role.manage, or into another organization', async () => {
    const invitee = `reissue-forbidden-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    await expect(reissueInvitation(stranger.db, { id: invitation.id })).rejects.toMatchObject({ code: 'invitations.reissue_forbidden' });
  });

  it('cannot be resent once accepted or revoked', async () => {
    const accepted = `reissue-accepted-${randomUUID().slice(0, 8)}@example.test`;
    const joiner = await signUp('deliv-accepted-joiner');
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await adminClient.auth.admin.updateUserById(joiner.userId, { email: accepted });
    const token = await inviteMember(admin.db, { organizationId, email: accepted, roleId });
    await acceptInvitation(joiner.db, { token, displayName: 'Joiner' });

    const { rows } = await pg.query('select id from public.organization_invitations where organization_id = $1 and email = $2', [organizationId, accepted]);
    await expect(reissueInvitation(admin.db, { id: rows[0].id })).rejects.toMatchObject({ code: 'invitations.reissue_invalid' });

    const revoked = `reissue-revoked-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: revoked, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === revoked)!;
    await revokeInvitation(admin.db, { id: invitation.id });

    await expect(reissueInvitation(admin.db, { id: invitation.id })).rejects.toMatchObject({ code: 'invitations.reissue_invalid' });
  });

  it('writes an audit event naming the invitation, the address and the role', async () => {
    const invitee = `reissue-audit-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(admin.db, { organizationId, email: invitee, roleId });
    const pending = await listPendingInvitations(admin.db, { organizationId });
    const invitation = pending.find((i) => i.email === invitee)!;

    await reissueInvitation(admin.db, { id: invitation.id });

    const { rows } = await pg.query(
      `select payload from public.events where organization_id = $1 and action = 'organization.member_invitation_reissued' and payload ->> 'invitation_id' = $2`,
      [organizationId, invitation.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.email).toBe(invitee);
    expect(rows[0].payload.role_id).toBe(roleId);
  });

  // --- tenant isolation on invitation_deliveries -----------------------------------------------

  describe('invitation_deliveries', () => {
    it('is never reachable across organizations', async () => {
      const invitee = `iso-${randomUUID().slice(0, 8)}@example.test`;
      await inviteMember(admin.db, { organizationId, email: invitee, roleId });
      const pending = await listPendingInvitations(admin.db, { organizationId });
      const invitation = pending.find((i) => i.email === invitee)!;

      await asProviderOperator(() =>
        pg.query(
          `select public.record_invitation_delivery($1, $2, $3, 'sent', 're_iso_test', null)`,
          [organizationId, invitation.id, invitee],
        ),
      );

      const { data: ownRead, error: ownError } = await admin.db
        .from('invitation_deliveries')
        .select('id')
        .eq('organization_id', organizationId);
      expect(ownError).toBeNull();
      expect(ownRead?.length).toBeGreaterThan(0);

      const { data: strangerRead, error: strangerError } = await stranger.db
        .from('invitation_deliveries')
        .select('id')
        .eq('organization_id', organizationId);
      expect(strangerError).toBeNull();
      expect(strangerRead).toEqual([]);
    });

    it('cannot be written to by any signed-in role, only provider_operator and invitation_email_webhook', async () => {
      const { rows } = await pg.query(
        `select
           has_function_privilege('authenticated', 'public.record_invitation_delivery(uuid,uuid,text,text,text,text,text)', 'execute') as send_authenticated,
           has_function_privilege('provider_operator', 'public.record_invitation_delivery(uuid,uuid,text,text,text,text,text)', 'execute') as send_operator,
           has_function_privilege('authenticated', 'public.record_invitation_delivery_event(text,text,text,jsonb,text)', 'execute') as webhook_authenticated,
           has_function_privilege('invitation_email_webhook', 'public.record_invitation_delivery_event(text,text,text,jsonb,text)', 'execute') as webhook_operator,
           has_function_privilege('authenticated', 'public.default_platform_provider_account(text)', 'execute') as default_authenticated,
           has_function_privilege('provider_operator', 'public.default_platform_provider_account(text)', 'execute') as default_operator`,
      );
      expect(rows[0]).toEqual({
        send_authenticated: false,
        send_operator: true,
        webhook_authenticated: false,
        webhook_operator: true,
        default_authenticated: false,
        default_operator: true,
      });

      const table = await pg.query(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_name = 'invitation_deliveries' and table_schema = 'public'
            and grantee in ('authenticated', 'anon')
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
      );
      expect(table.rows).toEqual([]);
    });
  });

  // --- the webhook's own correlation and idempotency --------------------------------------------

  describe('record_invitation_delivery_event', () => {
    it('derives the organization and invitation from the provider message id alone', async () => {
      const invitee = `corr-${randomUUID().slice(0, 8)}@example.test`;
      await inviteMember(admin.db, { organizationId, email: invitee, roleId });
      const pending = await listPendingInvitations(admin.db, { organizationId });
      const invitation = pending.find((i) => i.email === invitee)!;
      const messageId = `re_corr_${randomUUID()}`;

      await asProviderOperator(() =>
        pg.query(`select public.record_invitation_delivery($1, $2, $3, 'sent', $4, null)`, [organizationId, invitation.id, invitee, messageId]),
      );

      const id = await asInvitationEmailWebhook(async () => {
        const { rows } = await pg.query(
          `select public.record_invitation_delivery_event($1, 'delivered', null, '{}'::jsonb, $2) as id`,
          [messageId, `hash-${randomUUID()}`],
        );
        return rows[0].id as string | null;
      });
      expect(id).not.toBeNull();

      const { rows } = await pg.query('select organization_id, invitation_id, state from public.invitation_deliveries where id = $1', [id]);
      expect(rows[0]).toMatchObject({ organization_id: organizationId, invitation_id: invitation.id, state: 'delivered' });
    });

    it('is a harmless no-op for a message id this platform never sent', async () => {
      const id = await asInvitationEmailWebhook(async () => {
        const { rows } = await pg.query(
          `select public.record_invitation_delivery_event($1, 'delivered', null, '{}'::jsonb, $2) as id`,
          [`re_unknown_${randomUUID()}`, `hash-${randomUUID()}`],
        );
        return rows[0].id;
      });
      expect(id).toBeNull();
    });

    it('a retried callback with the same payload is a no-op, never a second row', async () => {
      const invitee = `retry-${randomUUID().slice(0, 8)}@example.test`;
      await inviteMember(admin.db, { organizationId, email: invitee, roleId });
      const pending = await listPendingInvitations(admin.db, { organizationId });
      const invitation = pending.find((i) => i.email === invitee)!;
      const messageId = `re_retry_${randomUUID()}`;
      const hash = `hash-${randomUUID()}`;

      await asProviderOperator(() =>
        pg.query(`select public.record_invitation_delivery($1, $2, $3, 'sent', $4, null)`, [organizationId, invitation.id, invitee, messageId]),
      );

      const first = await asInvitationEmailWebhook(async () => {
        const { rows } = await pg.query(`select public.record_invitation_delivery_event($1, 'bounced', 'mailbox full', '{}'::jsonb, $2) as id`, [messageId, hash]);
        return rows[0].id;
      });
      const second = await asInvitationEmailWebhook(async () => {
        const { rows } = await pg.query(`select public.record_invitation_delivery_event($1, 'bounced', 'mailbox full', '{}'::jsonb, $2) as id`, [messageId, hash]);
        return rows[0].id;
      });
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // the conflict, not a second row

      const { rows: count } = await pg.query(
        `select count(*)::int as n from public.invitation_deliveries where organization_id = $1 and payload_hash = $2`,
        [organizationId, hash],
      );
      expect(count[0].n).toBe(1);
    });
  });
});
