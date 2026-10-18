import { ReceptionistForm } from '@/features/communications/voice/receptionist-form';
import { ChannelReadiness } from '@/features/communications/channel-diagnostics';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { PageHeader } from '@/components/headers/page-header';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { VoiceSettingsContent } from '@/features/communications/voice/voice-settings-sheet';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listRoutes } from '@/lib/domain/reception/routing';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

export default async function CallSetupSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/configuration/calling'>) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'call-setup');
  const [outcomes, routes, numbers, number, members, senders] = await Promise.all([
    listCallOutcomes(db, { organizationId }),
    listRoutes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    callingNumber(db, { organizationId }),
    listMembers(db, { organizationId }),
    messagingSenders(db, { organizationId }),
  ]);

  const {data:receptionist,error:receptionistError}=await db.from('voice_receptionist_configs').select('revision,deployment_ref,enabled,max_session_seconds,monthly_budget_seconds').eq('organization_id',organizationId).maybeSingle();
  if(receptionistError)throw new Error(receptionistError.message);
  return (
    <SettingsPageFrame>
      <PageHeader
        title="Calling & routing" breadcrumbLabel="Calling"
        crumbs={[
          ...workspaceConfigCrumbs(organizationId, 'call-setup', gate),
        ]}

      />
      <VoiceSettingsContent
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
      {organization.capabilities.includes('organization.manage')?<ReceptionistForm organizationId={organizationId} config={receptionist}/>:null}
      <ChannelReadiness gate={gate} organizationId={organizationId} diagnostics={senders.diagnostics} maySend={organization.capabilities.includes('message.send')} />
    </SettingsPageFrame>
  );
}
