import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { requireOrganization } from '@/lib/route/organization';
import { OrganizationSettingsForm } from '../settings-forms';

export const dynamic = 'force-dynamic';

/**
 * Business identity, regional settings and the operating defaults that genuinely apply across
 * the whole business — name, slug, timezone, currency, buffer. Extracted from the former
 * `settings` god-page (product architecture decision, 2026): everything else that page used to
 * hold now has its own place in the Settings navigation.
 */
export default async function GeneralSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/general'>) {
  const { organizationId } = await params;
  const { organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>General</PageHeading>
      <Hint className="mt-1">
        This business&rsquo;s name, where it operates and what it trades in. Changing the
        currency does not reinterpret what past jobs cost, and changing the timezone does not
        move any booking — each amount carries the currency it was recorded in, and every
        scheduled window is an absolute instant.
      </Hint>

      {mayManage ? (
        <OrganizationSettingsForm
          organizationId={organizationId}
          name={organization.name}
          timezone={organization.timezone}
          bufferMinutes={organization.bufferMinutes}
          slug={organization.slug}
          currency={organization.currency}
        />
      ) : (
        <Hint className="mt-4">Your role, {organization.role}, cannot change these.</Hint>
      )}
    </SettingsPageFrame>
  );
}
