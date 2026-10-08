import { ActivityList } from '@/features/timeline/activity-list';
import type { Db } from '@/lib/db/types';
import { listRecentActivity, type ActivityScope } from '@/lib/domain/timeline/timeline';

/**
 * A workspace's Activity rail: what recently changed *here*. Read through `listRecentActivity`'s
 * named scope, so the sentences, the tenant's own vocabulary and the visibility rules are the
 * timeline's own — this component only places the list in a narrow rail.
 */
export async function WorkspaceActivity({
  db,
  organizationId,
  timezone,
  scope,
  emptyMessage,
  limit = 20,
  dense = false,
}: {
  db: Db;
  organizationId: string;
  timezone: string;
  scope: ActivityScope;
  emptyMessage: string;
  limit?: number;
  dense?: boolean;
}) {
  const timeline = await listRecentActivity(db, { organizationId, scope, limit, includeRecords: true });
  return <ActivityList organizationId={organizationId} compact dense={dense} timeline={timeline} timezone={timezone} emptyMessage={emptyMessage} />;
}
