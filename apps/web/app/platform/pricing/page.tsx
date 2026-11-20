import { notFound, redirect } from 'next/navigation';
import { callerOperatingOrganizationId } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

/**
 * GildOps' prices are recurring items in its own organization's Catalog & Pricing (ADR-057). Kept so
 * a bookmark still lands; Finance's own guard decides whether this person may see it, so a
 * platform permission alone opens nothing.
 */
export default async function RetiredPlatformPricingRoute(): Promise<never> {
  const organizationId = await callerOperatingOrganizationId();
  if (!organizationId) notFound();
  redirect(`/organizations/${organizationId}/finance/catalog`);
}
