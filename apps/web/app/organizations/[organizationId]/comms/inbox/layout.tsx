import type { ReactNode } from 'react';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { InboxShell } from '@/features/communications/inbox/inbox-shell';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * The Inbox frame: the conversation list persists while the pane beside it changes between a selected
 * conversation, a new one, and nothing selected. Refuse the frame before mounting its list; each pane
 * still checks access itself because this layout is reused across navigations.
 */
export default async function InboxLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  await requireOperatingArea(organizationId, 'comms-inbox');

  return (
    <AppPage>
      <CollectionHeader title={areaLabel('comms-inbox')} crumbs={workspaceAncestry(organizationId, 'comms-inbox')} className="mb-0" />
      <InboxShell organizationId={organizationId}>{children}</InboxShell>
    </AppPage>
  );
}
