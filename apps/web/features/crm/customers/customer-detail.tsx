import Link from 'next/link';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { ReactNode } from 'react';
import { Hint } from '@/components/controls/inputs';
import { DefinitionList, Detail } from '@/components/display/data';
import { SectionHeader } from '@/components/surfaces/section';
import { CompactEmptyState } from '@/components/operational/primitives';
import { RecordSubnavigation } from '@/components/navigation/record-subnavigation';
import { cx, FOCUS_RING } from '@/components/class-names';
import { CustomFieldDetails } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import { ActivityList } from '@/features/timeline/activity-list';
import { CallHistory } from '@/features/communications/voice/call-history';
import { PortalLinkForm } from '@/features/portal-access/portal-link-form';
import { PortalInviteList } from '@/features/portal-access/invite-list';
import { CommercialProposalSection, type ProposalInvoicing } from './commercial-proposal-section';
import { ConfigurationRecommendationSection } from './configuration-recommendation-section';
import { DiscoverySnapshotSection } from './discovery-snapshot-section';
import type { Invoice } from '@/lib/domain/billing/invoices';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { CommercialProposal } from '@/lib/domain/customers/commercial-proposals';
import type { ProposalInvite } from '@/lib/domain/customers/proposal-invites';
import type { AcceptedProposalHandoff } from '@/lib/domain/customers/proposal-handoff';
import type { ConfigurationRecommendation } from '@/lib/domain/customers/configuration-recommendation';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { DiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { StoredDocument } from '@/lib/domain/documents/documents';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { Location } from '@/lib/domain/locations/locations';
import type { PortalInvite } from '@/lib/domain/portal/portal';
import type { Call } from '@/lib/domain/reception/calls';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import {
  createPortalInviteAction,
  revokePortalInviteAction,
  uploadCustomerDocumentAction,
} from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions';
import { CustomerFinancialSummary } from './customer-financial-summary';
import { CustomerHeader } from './customer-header';
import { CustomerLocationsSection } from './customer-locations-section';
import { CustomerRelatedWork } from './customer-related-work';
import { EditContactDialog } from './edit-contact-dialog';
import { SECTION_LABELS, SECTION_VIEWS, VIEW_LABELS, recordHref, resolveRecordLocation, type Availability, type RecordSection, type RecordView } from './record-sections';

const TYPE_LABEL = { person: 'Person', company: 'Company', unspecified: 'Unspecified' } as const;

/**
 * The contact record: identity and quick actions, then seven top-level sections (Overview, Sales,
 * Tasks, Activity, Related, Documents, Portal) with contextual sub-sections. Every former tab's
 * content is kept, under the section it belongs to, and offered only where the viewer may open it
 * and the underlying capability applies. Sections are URL-backed, and old `?tab=` links resolve.
 */
export function CustomerDetail(props: {
  organizationId: string;
  query?: { section?: string; view?: string; tab?: string; classify?: string };
  opportunities?: ReactNode; opportunityCount?: number;
  followUps?: ReactNode; openTaskCount?: number;
  support?: ReactNode;
  services?: ReactNode;
  affiliations?: ReactNode;
  accessibleTenantIds?: string[];
  customer: Contact;
  stage: CustomerStage | null;
  stages: CustomerStage[];
  definitions: FieldDefinition[];
  documents: StoredDocument[];
  timeline: TimelineEntry[];
  work: WorkItem[];
  locations: Location[];
  /** Null when this deployment has not configured a basemap. */
  mapStyleUrl: string | null;
  calls: Call[];
  invoices: Invoice[];
  invites: PortalInvite[];
  discoverySnapshot: DiscoverySnapshot | null;
  configurationRecommendation: ConfigurationRecommendation | null;
  commercialProposals: CommercialProposal[];
  proposalInvites: ProposalInvite[];
  handoffsByProposalId: Record<string, AcceptedProposalHandoff>;
  invoicesByProposalId?: Record<string, { id: string; number: number }>;
  /** Set when this person may invoice an accepted proposal here (`invoice.issue`, Billing usable). */
  proposalInvoicing?: ProposalInvoicing;
  mayHandoff: boolean;
  mayPropose: boolean;
  catalogItems: PriceBookItem[];
  origin: string;
  portalOrigin?: string;
  timezone: string;
  currency: string;
  role: string;
  features: { voice: boolean; billing: boolean; portal: boolean };
  permissions: { edit: boolean; call: boolean; attach: boolean; portal: boolean; priceManage: boolean };
}) {
  const { organizationId, customer, stage, stages, definitions, features, permissions, mayPropose, role, timezone } = props;
  const base = `/organizations/${organizationId}/crm/contacts/${customer.id}`;
  const salesViews: RecordView[] = [...(props.opportunities ? ['opportunities' as const] : []), ...(mayPropose ? ['discovery' as const, 'configuration' as const] : []), ...(features.billing || props.commercialProposals.length > 0 ? ['commercial' as const] : []), ...(features.billing ? ['invoices' as const] : [])];
  const activityViews: RecordView[] = ['timeline', ...(features.voice ? ['calls' as const] : [])];
  const relatedViews: RecordView[] = ['work', 'locations', ...(props.support ? ['support' as const] : []), ...(props.services ? ['services' as const] : [])];
  const available: Availability = {
    sections: ['overview', ...(salesViews.length ? ['sales' as const] : []), ...(props.followUps ? ['tasks' as const] : []), 'activity', 'related', 'documents', ...(features.portal ? ['portal' as const] : [])],
    views: { sales: salesViews, activity: activityViews, related: relatedViews },
  };
  const { section, view } = resolveRecordLocation(props.query ?? {}, available);
  const sectionItems = available.sections.map(key => ({ key, label: SECTION_LABELS[key], href: recordHref(base, key, available.views[key]?.[0]) }));
  const viewItems = (available.views[section] ?? []).filter(key => SECTION_VIEWS[section].includes(key)).map(key => ({ key, label: VIEW_LABELS[key], href: recordHref(base, section, key) }));
  const editStages = features.voice ? stages : [];
  // `?classify=identity|lifecycle` (from Needs review) opens editing on that section; only when the viewer may edit.
  const classify = permissions.edit && (props.query?.classify === 'identity' || props.query?.classify === 'lifecycle') ? props.query.classify : null;

  return (
    <>
      <CustomerHeader organizationId={organizationId} customer={customer} stage={stage} definitions={definitions} stages={editStages} mayEdit={permissions.edit} mayCall={features.voice && permissions.call} openEditOn={classify === 'identity' ? 'identity' : classify === 'lifecycle' ? 'relationship' : undefined} />
      <RecordSubnavigation label="Contact sections" sections={sectionItems} current={section} subsections={viewItems} currentSubsection={view} />
      <div className="min-w-0">{renderSection(section, view)}</div>
    </>
  );

  function renderSection(current: RecordSection, currentView?: RecordView): ReactNode {
    switch (current) {
      case 'overview': return overview();
      case 'tasks': return props.followUps;
      case 'documents': return <DocumentsSection organizationId={organizationId} documents={props.documents} mayAttach={permissions.attach} roleLabel={role} uploadAction={uploadCustomerDocumentAction} hiddenFields={{ organizationId, customerId: customer.id }} className="mt-0" />;
      case 'portal': return <>
        <Hint>Anyone holding this link can see this contact’s own work and invoices.</Hint>
        {permissions.portal ? <><PortalLinkForm organizationId={organizationId} customerId={customer.id} origin={props.portalOrigin ?? props.origin} createAction={createPortalInviteAction} /><PortalInviteList organizationId={organizationId} customerId={customer.id} invites={props.invites} origin={props.portalOrigin ?? props.origin} revokeAction={revokePortalInviteAction} /></> : <Hint className="mt-3">Your role, {role}, cannot manage this contact&apos;s portal access.</Hint>}
      </>;
      default: return renderView(currentView);
    }
  }

  function renderView(currentView?: RecordView): ReactNode {
    switch (currentView) {
      case 'opportunities': return props.opportunities;
      case 'discovery': return <DiscoverySnapshotSection organizationId={organizationId} customerId={customer.id} snapshot={props.discoverySnapshot} mayEdit={permissions.edit} role={role} />;
      case 'configuration': return props.configurationRecommendation ? <ConfigurationRecommendationSection recommendation={props.configurationRecommendation} /> : <CompactEmptyState>No proposed setup yet. It comes from the answers on Discovery.</CompactEmptyState>;
      case 'commercial': return <CommercialProposalSection accessibleTenantIds={props.accessibleTenantIds} organizationId={organizationId} customerId={customer.id} proposals={props.commercialProposals} invites={props.proposalInvites} handoffsByProposalId={props.handoffsByProposalId} mayHandoff={props.mayHandoff} origin={props.origin} catalogItems={props.catalogItems} mayBuild={features.billing && permissions.priceManage} mayEdit={permissions.priceManage} role={role} currency={props.currency} invoicesByProposalId={props.invoicesByProposalId} invoicing={props.proposalInvoicing ?? null} />;
      case 'invoices': return <CustomerFinancialSummary organizationId={organizationId} invoices={props.invoices} timezone={timezone} />;
      case 'timeline': return <ActivityList timeline={props.timeline} timezone={timezone} />;
      case 'calls': return <>{<CallHistory organizationId={organizationId} timeZone={timezone} calls={props.calls} empty="No calls with this contact." />}{permissions.call ? null : <Hint className="mt-4">Your role, {role}, cannot call contacts.</Hint>}</>;
      case 'work': return <CustomerRelatedWork organizationId={organizationId} work={props.work} />;
      case 'locations': return <CustomerLocationsSection organizationId={organizationId} customerId={customer.id} locations={props.locations} mapStyleUrl={props.mapStyleUrl} />;
      case 'support': return props.support;
      case 'services': return props.services;
      default: return null;
    }
  }

  function overview() {
    const unspecified = !customer.contactType || customer.contactType === 'unspecified';
    const related = [
      ...(salesViews.includes('opportunities') ? [{ label: 'Opportunities', count: props.opportunityCount, href: recordHref(base, 'sales', 'opportunities') }] : []),
      ...(props.followUps ? [{ label: 'Open tasks', count: props.openTaskCount, href: recordHref(base, 'tasks') }] : []),
      { label: 'Work', count: props.work.length, href: recordHref(base, 'related', 'work') },
      { label: 'Locations', count: props.locations.length, href: recordHref(base, 'related', 'locations') },
      ...(features.voice ? [{ label: 'Calls', count: props.calls.length, href: recordHref(base, 'activity', 'calls') }] : []),
      { label: 'Documents', count: props.documents.length, href: recordHref(base, 'documents') },
      ...(props.support ? [{ label: 'Support cases', count: undefined, href: recordHref(base, 'related', 'support') }] : []),
    ];
    return <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        {unspecified ? <div role="status" className="flex flex-wrap items-center gap-3 rounded-[var(--visual-radius,0.625rem)] border border-border bg-secondary px-4 py-3 text-sm">
          <span className="min-w-0 flex-1"><span className="font-medium">Needs classification.</span> Choose Person or Company; only people can be linked to a company.</span>
          {permissions.edit ? <EditContactDialog organizationId={organizationId} customer={customer} definitions={definitions} stages={editStages} label="Classify contact" tone="primary" icon={false} initialSection="identity" /> : null}
        </div> : null}
        <section aria-labelledby="contact-details" className="flex flex-col gap-3">
          <SectionHeader id="contact-details" title="Details" />
          <DefinitionList>
            <Detail label="Type">{TYPE_LABEL[customer.contactType ?? 'unspecified']}</Detail>
            {customer.companyId ? <Detail label="Company"><Link className="hover:underline" href={`/organizations/${organizationId}/crm/contacts/${customer.companyId}`}>{customer.companyName}</Link></Detail> : null}
            <Detail label="Email">{customer.email ? <a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a> : <span className="text-muted">Not recorded</span>}</Detail>
            <Detail label="Phone">{customer.phone ? <a href={`tel:${customer.phone}`} className="hover:underline">{formatPhoneForDisplay(customer.phone)}</a> : <span className="text-muted">Not recorded</span>}</Detail>
            {editStages.length ? <Detail label="Relationship stage">{stage?.name ?? 'None'}</Detail> : null}
            <Detail label="Added">{customer.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'medium' }).format(new Date(customer.createdAt)) : null}</Detail>
            <CustomFieldDetails definitions={definitions} custom={customer.custom} />
          </DefinitionList>
          {!permissions.edit ? <Hint>Your role, {role}, cannot change this contact.</Hint> : null}
        </section>
        {props.affiliations}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="contact-recent" className="flex flex-col gap-2">
          <SectionHeader id="contact-recent" title="Recent activity" action={props.timeline.length > 5 ? <Link href={recordHref(base, 'activity', 'timeline')} className={cx('text-xs font-medium text-accent-text underline underline-offset-4', FOCUS_RING)}>View all activity</Link> : null} />
          {props.timeline.length ? <ActivityList timeline={props.timeline.slice(0, 5)} timezone={timezone} /> : <CompactEmptyState>No activity recorded yet.</CompactEmptyState>}
        </section>
        <section aria-labelledby="contact-related" className="flex flex-col gap-2">
          <SectionHeader id="contact-related" title="Related" />
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface">
            {related.map(item => <li key={item.label}><Link href={item.href} className={cx('flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-hover', FOCUS_RING)}>
              <span>{item.label}</span>{item.count !== undefined ? <span className="tabular-nums text-muted">{item.count}</span> : <span aria-hidden className="text-muted">›</span>}
            </Link></li>)}
          </ul>
        </section>
      </div>
    </div>;
  }
}
