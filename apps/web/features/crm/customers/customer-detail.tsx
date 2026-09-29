import { Hint } from '@/components/controls/inputs';
import { DefinitionList, Detail } from '@/components/display/data';
import { Section, SectionHeading } from '@/components/containers/section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import { ActivityList } from '@/features/timeline/activity-list';
import { CallHistory } from '@/features/communications/voice/call-history';
import { PortalLinkForm } from '@/features/portal-access/portal-link-form';
import { PortalInviteList } from '@/features/portal-access/invite-list';
import { CommercialProposalSection } from './commercial-proposal-section';
import { ConfigurationRecommendationSection } from './configuration-recommendation-section';
import { DiscoverySnapshotSection } from './discovery-snapshot-section';
import type { Invoice } from '@/lib/domain/billing/invoices';
import type { Plan } from '@/lib/domain/catalogue/plans';
import type { CommercialProposal } from '@/lib/domain/customers/commercial-proposals';
import type { ConfigurationRecommendation } from '@/lib/domain/customers/configuration-recommendation';
import type { Customer } from '@/lib/domain/customers/customers';
import type { DiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { StoredDocument } from '@/lib/domain/documents/documents';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { PortalInvite } from '@/lib/domain/portal/portal';
import type { Call } from '@/lib/domain/reception/calls';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import {
  createPortalInviteAction,
  revokePortalInviteAction,
  uploadCustomerDocumentAction,
} from '@/app/organizations/[organizationId]/customers/[customerId]/actions';
import { CustomerFinancialSummary } from './customer-financial-summary';
import { CustomerHeader } from './customer-header';
import { CustomerRelatedWork } from './customer-related-work';

export function CustomerDetail({
  organizationId,
  customer,
  stage,
  stages,
  definitions,
  documents,
  timeline,
  work,
  calls,
  invoices,
  invites,
  discoverySnapshot,
  configurationRecommendation,
  commercialProposals,
  plans,
  addonPlans,
  origin,
  timezone,
  currency,
  role,
  features,
  permissions,
}: {
  organizationId: string;
  customer: Customer;
  stage: CustomerStage | null;
  stages: CustomerStage[];
  definitions: FieldDefinition[];
  documents: StoredDocument[];
  timeline: TimelineEntry[];
  work: WorkItem[];
  calls: Call[];
  invoices: Invoice[];
  invites: PortalInvite[];
  discoverySnapshot: DiscoverySnapshot | null;
  configurationRecommendation: ConfigurationRecommendation;
  commercialProposals: CommercialProposal[];
  plans: Plan[];
  addonPlans: Plan[];
  origin: string;
  timezone: string;
  currency: string;
  role: string;
  features: { voice: boolean; billing: boolean; portal: boolean };
  permissions: { edit: boolean; call: boolean; attach: boolean; portal: boolean; priceManage: boolean };
}) {
  return (
    <>
      <CustomerHeader organizationId={organizationId} customer={customer} stage={stage} definitions={definitions} stages={features.voice ? stages : []} mayEdit={permissions.edit} mayCall={features.voice && permissions.call} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
          <TabsTrigger value="configuration">Proposed configuration</TabsTrigger>
          <TabsTrigger value="commercial">Commercial proposal</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
          {features.voice ? <TabsTrigger value="calls">Calls</TabsTrigger> : null}
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {features.billing ? <TabsTrigger value="invoices">Invoices</TabsTrigger> : null}
          {features.portal ? <TabsTrigger value="portal">Portal</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <Section>
            <SectionHeading>Contact information</SectionHeading>
            <DefinitionList className="mt-3">
              <Detail label="Email">{customer.email ? <a href={`mailto:${customer.email}`} className="underline underline-offset-4">{customer.email}</a> : 'Not recorded'}</Detail>
              <Detail label="Phone">{customer.phone ? <a href={`tel:${customer.phone}`} className="underline underline-offset-4">{customer.phone}</a> : 'Not recorded'}</Detail>
              <Detail label="Stage">{stage?.name ?? 'No stage'}</Detail>
            </DefinitionList>
            <CustomFieldValues definitions={definitions} custom={customer.custom} />
            {!permissions.edit ? <Hint className="mt-6">Your role, {role}, cannot change this customer.</Hint> : null}
          </Section>
        </TabsContent>

        <TabsContent value="discovery" className="mt-6">
          <DiscoverySnapshotSection
            organizationId={organizationId}
            customerId={customer.id}
            snapshot={discoverySnapshot}
            mayEdit={permissions.edit}
            role={role}
          />
        </TabsContent>
        <TabsContent value="configuration" className="mt-6">
          <ConfigurationRecommendationSection recommendation={configurationRecommendation} />
        </TabsContent>
        <TabsContent value="commercial" className="mt-6">
          <CommercialProposalSection
            organizationId={organizationId}
            customerId={customer.id}
            proposals={commercialProposals}
            plans={plans}
            addonPlans={addonPlans}
            mayEdit={permissions.priceManage}
            role={role}
            currency={currency}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-6"><ActivityList timeline={timeline} timezone={timezone} /></TabsContent>
        <TabsContent value="work" className="mt-6"><CustomerRelatedWork organizationId={organizationId} work={work} /></TabsContent>
        {features.voice ? <TabsContent value="calls" className="mt-6"><CallHistory calls={calls} empty="No calls with this customer." />{permissions.call ? null : <Hint className="mt-4">Your role, {role}, cannot call customers.</Hint>}</TabsContent> : null}
        <TabsContent value="documents" className="mt-6"><DocumentsSection organizationId={organizationId} documents={documents} mayAttach={permissions.attach} roleLabel={role} uploadAction={uploadCustomerDocumentAction} hiddenFields={{ organizationId, customerId: customer.id }} className="mt-0" /></TabsContent>
        {features.billing ? <TabsContent value="invoices" className="mt-6"><CustomerFinancialSummary organizationId={organizationId} invoices={invoices} timezone={timezone} /></TabsContent> : null}
        {features.portal ? (
          <TabsContent value="portal" className="mt-6">
            <Hint>A link this customer can open to see their own work and invoices. Anyone holding it is them.</Hint>
            {permissions.portal ? <><PortalLinkForm organizationId={organizationId} customerId={customer.id} origin={origin} createAction={createPortalInviteAction} /><PortalInviteList organizationId={organizationId} customerId={customer.id} invites={invites} origin={origin} revokeAction={revokePortalInviteAction} /></> : <Hint className="mt-3">Your role, {role}, cannot manage this customer&apos;s portal access.</Hint>}
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
