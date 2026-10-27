import { redirect } from 'next/navigation';
import { configurationTargetOffered } from '@/lib/route/workspace-configuration';
import { legacyPaymentSettingsHref } from '@/lib/route/settings';

/** Retired. The price book is Finance's Catalog & Pricing; card payments moved to Settings → Customer payments. */
export default async function CommerceSettingsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/settings/commerce'>) {
  const { organizationId } = await params;
  redirect(legacyPaymentSettingsHref(organizationId, await configurationTargetOffered(organizationId, 'payments')));
}
