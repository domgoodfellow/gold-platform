import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { WidgetPanel } from '@/components/display/widget';
import { CallHistory } from '@/features/communications/voice/call-history';
import { VoiceOverview } from '@/features/communications/voice/voice-overview';
import { VoiceSettingsSheet } from '@/features/communications/voice/voice-settings-sheet';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listCalls } from '@/lib/domain/reception/calls';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function CallsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [calls, outcomes, stages, customers, number] = await Promise.all([
    listCalls(db, { organizationId }),
    listCallOutcomes(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomers(db, { organizationId }),
    callingNumber(db, { organizationId }),
  ]);
  const query = await searchParams;
  const open = Array.isArray(query.widget) ? query.widget[0] : query.widget;
  const area = `/organizations/${organizationId}/calls`;
  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const todaysCalls = calls.filter((call) => call.startedAt >= day.startsAt && call.startedAt < day.endsAt);
  const mayCall = organization.capabilities.includes('call.place');

  if (open === 'calls') {
    return (
      <AppPage width="wide">
        <PageHeader title={areaLabel('calls')} />
        <WidgetPanel title="Every call" backHref={area} backLabel="Calls">
          <CallHistory
            calls={calls}
            customerNames={names}
            renderWrapUp={mayCall ? (call) => <WrapUpCallSheet organizationId={organizationId} call={call} outcomes={outcomes} /> : undefined}
          />
        </WidgetPanel>
      </AppPage>
    );
  }

  return (
    <AppPage width="wide">
      <PageHeader
        title={areaLabel('calls')}
        description="Calling activity, follow-up and the identity this business calls from."
        actions={
          <div id="setup" className="scroll-mt-20">
            <VoiceSettingsSheet
              organizationId={organizationId}
              number={number}
              outcomes={outcomes}
              mayManageIdentity={organization.capabilities.includes('organization.manage')}
              mayConfigureOutcomes={organization.capabilities.includes('field.manage')}
              role={organization.role}
            />
          </div>
        }
      />
      <VoiceOverview organizationId={organizationId} calls={calls} todaysCalls={todaysCalls} customers={customers} stages={stages} />
    </AppPage>
  );
}
