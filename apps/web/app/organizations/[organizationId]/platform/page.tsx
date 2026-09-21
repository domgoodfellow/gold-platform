import { PlatformOverview } from '@/features/platform/platform-overview';
import { getDb } from '@/lib/db/server';
import { platformOverview } from '@/lib/domain/platform/overview';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

export default async function PlatformPage({ params }: PageProps<'/organizations/[organizationId]/platform'>) {
  const { organizationId: goldId } = await params;
  // The front door: an operator without the overview's permission is sent to the first place they may go.
  await requirePlatformArea(goldId, 'platform.health', { landing: true });
  const db = await getDb();
  const data = await platformOverview(db);
  return <PlatformOverview goldId={goldId} {...data} />;
}
