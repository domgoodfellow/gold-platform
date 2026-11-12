import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';
import { listMembers } from './members';
import { listRoles } from './roles';

/**
 * Who changed access, when, and what. A read of the business's own event log, which the database
 * functions that change access already write and nobody can edit: nothing is recorded here, and
 * nothing is inferred that an event does not say. An event the screen has no sentence for is left
 * out, never shown as a code.
 */
export type AccessChange = {
  id: string;
  occurredAt: string;
  /** The member who made the change, by the name this business knows them by. */
  actor: string;
  summary: string;
};

const ACTIONS = [
  'role.created',
  'role.updated',
  'role.deleted',
  'membership.created',
  'membership.role_assigned',
  'organization.member_invited',
  'organization.member_invitation_accepted',
  'organization.member_invitation_revoked',
  'organization.member_invitation_reissued',
] as const;

type Payload = Record<string, unknown>;

function text(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function count(payload: Payload): string {
  const capabilities = payload.capabilities;
  const total = Array.isArray(capabilities) ? capabilities.length : 0;
  return total === 1 ? '1 permission' : `${total} permissions`;
}

export async function listAccessChanges(db: Db, input: { organizationId: string; limit?: number; offset?: number }): Promise<AccessChange[]> {
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const [events, members, roles] = await Promise.all([
    db
      .from('events')
      .select('id, actor_id, entity_id, action, payload, occurred_at')
      .eq('organization_id', input.organizationId)
      .in('action', [...ACTIONS])
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + (input.limit ?? 200) - 1),
    listMembers(db, { organizationId: input.organizationId }),
    listRoles(db, { organizationId: input.organizationId }),
  ]);
  if (events.error) throw fromDatabaseError(events.error, 'access_history.list_failed');

  const byUser = new Map(members.map((member) => [member.userId, member.displayName]));
  const byMembership = new Map(members.map((member) => [member.id, member.displayName]));
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const role = (id: string | null) => (id ? roleName.get(id) : undefined) ?? 'a role that has since been deleted';

  return (events.data ?? []).flatMap((event) => {
    const payload = (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {}) as Payload;
    const person = byMembership.get(event.entity_id) ?? text(payload, 'display_name') ?? 'a former member';
    const email = text(payload, 'email') ?? 'somebody';
    const summary = (() => {
      switch (event.action) {
        case 'role.created': return `Created the role ${text(payload, 'name') ?? role(event.entity_id)} with ${count(payload)}`;
        case 'role.updated': return `Changed the role ${text(payload, 'name') ?? role(event.entity_id)}, which now has ${count(payload)}`;
        case 'role.deleted': return `Deleted the role ${text(payload, 'name') ?? ''}`.trim();
        case 'membership.created': return `Added ${person} as ${role(text(payload, 'role_id'))}`;
        case 'membership.role_assigned': return `Changed ${person} to ${role(text(payload, 'role_id'))}`;
        case 'organization.member_invited': return `Invited ${email} as ${role(text(payload, 'role_id'))}`;
        case 'organization.member_invitation_accepted': return `${email} accepted an invitation and joined`;
        case 'organization.member_invitation_revoked': return `Revoked the invitation to ${email}`;
        case 'organization.member_invitation_reissued': return `Sent the invitation to ${email} again`;
        default: return null;
      }
    })();
    if (!summary) return [];
    return [{
      id: event.id,
      occurredAt: event.occurred_at,
      actor: byUser.get(event.actor_id) ?? 'A former member',
      summary,
    }];
  });
}
