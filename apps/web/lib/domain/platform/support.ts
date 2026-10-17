import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Support access, kept separate from membership (the platform-staff separation, restated). Starting a session is the one
 * thing that makes "Open Organization" more than a click that leaves no trace — every session is
 * a row naming who, which business, when, and until when. It grants no new read on any other
 * table; it is the "why were you looking" record, not a second access path.
 */

export type SupportSession = {
  id: string;
  organizationId: string;
  reason: string | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
};

export async function startSupportSession(
  db: Db,
  input: { organizationId: string; reason?: string },
): Promise<string> {
  const { data, error } = await db.rpc('start_support_session', {
    p_organization_id: input.organizationId,
    p_reason: input.reason,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff may open a support session.', 'support.forbidden');
    }
    throw new DomainError(error.message, 'support.start_failed');
  }

  return data as string;
}

export async function endSupportSession(db: Db, input: { id: string }): Promise<void> {
  const { error } = await db.rpc('end_support_session', { p_id: input.id });

  if (error) {
    throw new DomainError(error.message, 'support.end_failed');
  }
}

/**
 * The session that would let a support-mode view render right now, if any — active, not
 * expired, not ended, and **this caller's own**. The select policy on
 * `platform_support_sessions` admits every staff member's rows, not only the caller's — that is
 * deliberate, for a future audit screen — so this is the one place that narrows to "mine," or a
 * second staff member opening the same organization would see (and could be shown UI implying
 * they could end) the first staff member's session instead of their own.
 */
export async function activeSupportSession(
  db: Db,
  input: { organizationId: string },
): Promise<SupportSession | null> {
  const actor = await requireActor(db);

  const { data, error } = await db
    .from('platform_support_sessions')
    .select('id, organization_id, reason, started_at, expires_at, ended_at')
    .eq('organization_id', input.organizationId)
    .eq('staff_user_id', actor.id)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new DomainError(error.message, 'support.session_lookup_failed');
  }

  const row = data?.[0];
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    reason: row.reason,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
  };
}

export type SupportMember = {
  id: string;
  displayName: string;
  createdAt: string;
};

/**
 * Who is on this team, read the way platform staff are actually allowed to read it today:
 * `memberships` in full, `roles` not at all (the platform-staff separation's grant list has never included it). A role
 * name would need that grant widened — a real, separate decision, not a side effect of this one.
 */
export async function listMembersForSupport(
  db: Db,
  input: { organizationId: string },
): Promise<SupportMember[]> {
  const { data, error } = await db
    .from('memberships')
    .select('id, display_name, created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'support.members_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
  }));
}
