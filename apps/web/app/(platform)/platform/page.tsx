import { PlatformOverview } from '@/features/platform/platform-overview';
import { getDb } from '@/lib/db/server';
import { platformOverview } from '@/lib/domain/platform/overview';

export const dynamic = 'force-dynamic';

export default async function PlatformPage() {
  const db = await getDb();
  const data = await platformOverview(db);
  return <PlatformOverview {...data} />;
}
