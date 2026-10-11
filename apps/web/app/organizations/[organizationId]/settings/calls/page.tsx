import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { PageHeader } from '@/components/headers/page-header';
import Link from 'next/link';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { VoiceSettingsContent } from '@/features/communications/voice/voice-settings-sheet';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listRoutes } from '@/lib/domain/reception/routing';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function CallSetupSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [outcomes, routes, numbers, number, members, senders] = await Promise.all([
    listCallOutcomes(db, { organizationId }),
    listRoutes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    callingNumber(db, { organizationId }),
    listMembers(db, { organizationId }),
    messagingSenders(db, { organizationId }),
  ]);

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Communications configuration"
        crumbs={[
          ...workspaceConfigCrumbs(organizationId, 'call-setup'),
        ]}

      />
      <div className="grid min-w-0 gap-4 md:grid-cols-[12rem_minmax(0,1fr)]"><nav aria-label="Communications configuration sections" className="flex flex-wrap gap-3 text-sm md:flex-col"><Link href={`/organizations/${organizationId}/comms`} className="text-accent-text">Communications Home</Link><Link href="#channels">Channels and readiness</Link><Link href="#caller-identity">Caller identity</Link><Link href={`/organizations/${organizationId}/comms/numbers`}>Numbers and assignments</Link><Link href="#routing">Inbound routing</Link><Link href="#outcomes">Call outcomes</Link><Link href="#business-hours">Business hours</Link><Link href="#recording">Recording</Link><Link href="#compliance">Compliance</Link></nav><div className="min-w-0"><VoiceSettingsContent
            organizationId={organizationId}
            number={number}
            channelReadiness={{ sms: senders.numbers.length, email: senders.senders.length }}
            outcomes={outcomes}
            routes={routes}
            numbers={numbers}
            members={members.map((member) => ({ id: member.id, displayName: member.displayName }))}
            mayManageIdentity={organization.capabilities.includes('organization.manage')}
            mayConfigureOutcomes={organization.capabilities.includes('field.manage')}
            role={organization.role}
          /></div></div>
    </SettingsPageFrame>
  );
}
