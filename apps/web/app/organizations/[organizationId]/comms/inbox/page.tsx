import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/** Nothing selected: on a wide screen the pane beside the list says so; on a narrow one the list is the screen and this is hidden. */
export default async function InboxPage({ params }: PageProps<'/organizations/[organizationId]/comms/inbox'>) {
  const { organizationId } = await params;
  await requireOperatingArea(organizationId, 'comms-inbox');
  return <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted">Select a conversation</div>;
}
