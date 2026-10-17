import type { Member } from '@/lib/domain/tenancy/members';
import type { Resource } from '@/lib/domain/resources/resources';

/** What the "represents member" control offers: a membership id and the tenant's own word for them. */
export type AvailableMember = { membershipId: string; displayName: string };

/**
 * Members not already representing another Resource — the "must not be offered as if freely
 * available" half of Slice 0B's UI requirement. `excludeResourceId` keeps a Resource's own
 * current link selectable while it is being edited, rather than hiding the very choice already
 * in effect. The attempted write is still refused with a clear error if this list is ever
 * stale (`resources.member_already_linked`) — this is a courtesy, not the guard.
 */
export function availableMembers(
  members: Member[],
  resources: Resource[],
  options: { excludeResourceId?: string } = {},
): AvailableMember[] {
  const linked = new Set(
    resources
      .filter((resource) => resource.id !== options.excludeResourceId)
      .map((resource) => resource.member?.membershipId)
      .filter((id): id is string => Boolean(id)),
  );

  return members.filter((member) => !linked.has(member.id)).map((member) => ({
    membershipId: member.id,
    displayName: member.displayName,
  }));
}
