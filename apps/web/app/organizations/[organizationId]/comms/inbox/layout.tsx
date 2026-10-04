import type { ReactNode } from 'react';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { InboxShell } from '@/features/communications/inbox/inbox-shell';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * The Inbox frame: the conversation list persists while the pane beside it changes between a selected
 * conversation, a new one, and nothing selected. The page of each pane proves the business for itself —
 * a layout is reused across navigations and is never the authorization.
 */
export default async function InboxLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <AppPage>
      <CollectionHeader title={areaLabel('comms-inbox')} crumbs={workspaceAncestry(organizationId, 'comms-inbox')} />
      <InboxShell organizationId={organizationId}>{children}</InboxShell>
    </AppPage>
  );
}
