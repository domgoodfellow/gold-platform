'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { type AutomationsView } from './views';

/**
 * The one client controller in this workspace whose whole job is keeping `?view=` and the
 * visible tab in step — selecting a tab pushes a new URL rather than holding state a reload or
 * the back button would lose. The content itself renders server-side, keyed off the same
 * `view`, outside this component entirely.
 */
export function AutomationsViewTabs({
  view,
  messageCount,
}: {
  view: AutomationsView;
  /** Shown beside the tab label the way Roles shows a pending-invitation count. */
  messageCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Tabs
      value={view}
      onValueChange={(next) => router.push(`${pathname}?view=${next}`)}
    >
      <TabsList>
        <TabsTrigger value="rules">Rules</TabsTrigger>
        <TabsTrigger value="messages">
          Messages{messageCount ? ` (${messageCount})` : ''}
        </TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
