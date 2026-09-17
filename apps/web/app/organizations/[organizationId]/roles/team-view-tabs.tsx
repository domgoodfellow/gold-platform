'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import type { TeamView } from './team-views';

/**
 * The one client controller in this workspace whose whole job is keeping `?view=` and the
 * visible tab in step — selecting a tab pushes a new URL rather than holding state a reload or
 * the back button would lose. The content itself renders server-side, keyed off the same `view`.
 */
export function TeamViewTabs({
  view,
  invitationCount,
}: {
  view: TeamView;
  invitationCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Tabs value={view} onValueChange={(next) => router.push(`${pathname}?view=${next}`)}>
      <TabsList>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="invitations">
          Invitations{invitationCount ? ` (${invitationCount})` : ''}
        </TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
