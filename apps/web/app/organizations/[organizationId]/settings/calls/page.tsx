import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { VoiceSettingsSheet } from '@/features/communications/voice/voice-settings-sheet';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listRoutes } from '@/lib/domain/reception/routing';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

export const dynamic = 'force-dynamic';

/**
 * Communications' own configuration door — call outcomes, routing and caller identity — reached
 * directly from Settings rather than through the Calls workspace's own `#setup` anchor (that
 * anchor still exists, for the module Features screen's "configure this" link; this is the
 * canonical Settings destination). Reuses `VoiceSettingsSheet` as-is; the Calls workspace keeps
 * its own copy of the same trigger for someone already working there.
 */
export default async function CallSetupSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [outcomes, routes, numbers, number, members] = await Promise.all([
    listCallOutcomes(db, { organizationId }),
    listRoutes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    callingNumber(db, { organizationId }),
    listMembers(db, { organizationId }),
  ]);

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Call setup"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
        ]}
        actions={
          <VoiceSettingsSheet
            organizationId={organizationId}
            number={number}
            outcomes={outcomes}
            routes={routes}
            numbers={numbers}
            members={members.map((member) => ({ id: member.id, displayName: member.displayName }))}
            mayManageIdentity={organization.capabilities.includes('organization.manage')}
            mayConfigureOutcomes={organization.capabilities.includes('field.manage')}
            role={organization.role}
          />
        }
      />
      <Hint>
        The words this business uses for how a call went, routing and caller identity. Opened here,
        edited in Communications settings.
      </Hint>
    </SettingsPageFrame>
  );
}
