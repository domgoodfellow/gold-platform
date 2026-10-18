'use client';
import { BusinessLabel } from '@/lib/context/business-vocabulary';

import { useActionState, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { engagementAction, readEngagementDetails } from '@/app/organizations/[organizationId]/customers/[customerId]/service-actions';
import { ARTIFACT_KINDS, SERVICE_KINDS, type Engagement } from '@/lib/domain/customers/service-engagements';
import type { ClientTenantRelationship } from '@/lib/domain/customers/client-tenants';
import { ServiceDisclosureEditor } from './service-disclosure-editor';
import { ServiceReviewSection } from './service-review-section';
import { ServiceNotificationSection } from './service-notification-section';

type Options = { organizationId: string; customerId: string; mayManage: boolean; relationships: ClientTenantRelationship[]; opportunities: { id: string; title: string }[]; proposals: { id: string; version: number; status: string }[]; work: { id: string; title: string }[] };

function ContextInputs({ organizationId, customerId, engagementId }: { organizationId: string; customerId: string; engagementId?: string }) {
  return <><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="customerId" value={customerId}/>{engagementId ? <input type="hidden" name="engagementId" value={engagementId}/> : null}</>;
}

function NewEngagement({ options, onSaved }: { options: Options; onSaved: () => void }) {
  const [state, action, pending] = useActionState(engagementAction, { error: null, saved: false });
  const id = useId();
  useEffect(() => { if (state.saved) onSaved(); }, [state, onSaved]);
  return <form action={action} className="flex min-h-0 flex-1 flex-col"><ContextInputs {...options}/><input type="hidden" name="operation" value="create"/>
    <div className="flex-1 space-y-4 overflow-y-auto">
      <FormField id={`${id}-name`} label="Engagement name">{props => <TextInput {...props} name="name" required maxLength={200}/>}</FormField>
      <FormField id={`${id}-kind`} label="Service">{props => <SelectInput {...props} name="serviceKind" defaultValue="website">{Object.entries(SERVICE_KINDS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</SelectInput>}</FormField>
      <FormField id={`${id}-relationship`} label="Linked organization" optional>{props => <SelectInput {...props} name="relationshipId" defaultValue=""><option value="">No tenant yet</option>{options.relationships.filter(r => r.status === 'active').map(r => <option key={r.id} value={r.id}>{r.tenant_name}</option>)}</SelectInput>}</FormField>
      <details><summary className="cursor-pointer text-sm">Commercial origin</summary><div className="mt-3 space-y-4">
        <FormField id={`${id}-opportunity`} label="Opportunity" optional>{props => <SelectInput {...props} name="opportunityId" defaultValue=""><option value="">None</option>{options.opportunities.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</SelectInput>}</FormField>
        <FormField id={`${id}-proposal`} label="Accepted proposal" optional>{props => <SelectInput {...props} name="proposalId" defaultValue=""><option value="">None</option>{options.proposals.filter(p => p.status === 'accepted').map(p => <option key={p.id} value={p.id}>Version {p.version}</option>)}</SelectInput>}</FormField>
      </div></details>
      <ErrorText role="alert">{state.error}</ErrorText>
    </div>
    <div className="drawer-footer"><Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create engagement'}</Button></div>
  </form>;
}

function artifactHref(organizationId: string, kind: string, artifactId: string) {
  const paths: Record<string, string> = { website: '/studio/website', form: `/studio/forms/${artifactId}`, ai_deployment: '/ai', automation: `/automations/${artifactId}`, portal: '/studio/portal' };
  return paths[kind] ? `/organizations/${organizationId}${paths[kind]}` : null;
}

function EngagementDetails({ item, options }: { item: Engagement; options: Options }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState(engagementAction, { error: null, saved: false });
  const [details, setDetails] = useState<Awaited<ReturnType<typeof readEngagementDetails>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const refreshDisclosure = useCallback(() => setRefresh(value => value + 1), []);
  const id = useId();
  const open = item.status === 'planned' || item.status === 'active';
  const relationship = options.relationships.find(r => r.id === item.relationship_id);
  useEffect(() => {
    if (contentRef.current && document.activeElement === document.body) {
      contentRef.current.closest<HTMLElement>('[data-page-drawer]')?.focus();
    }
  }, [open, item.relationship_id, pending, details?.disclosure?.version, relationship?.status]);
  useEffect(() => {
    let current = true;
    readEngagementDetails(options.organizationId, options.customerId, item.id, query).then(result => { if (current) { setDetails(result); setError(null); } }).catch(() => { if (current) setError('Engagement details could not be loaded. Close and try again.'); });
    return () => { current = false; };
  }, [options.organizationId, options.customerId, item.id, state, query, refresh, relationship?.status]);
  const terms = item.accepted_terms && typeof item.accepted_terms === 'object' && !Array.isArray(item.accepted_terms) ? item.accepted_terms : null;
  return <div ref={contentRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto">
    <div><p className="text-sm capitalize">{item.status}</p><p className="text-sm text-muted">{relationship ? relationship.tenant_name : 'No tenant yet'}</p></div>
    <ErrorText role="alert">{state.error ?? error}</ErrorText>{state.saved ? <p role="status" className="text-sm">Saved.</p> : null}
    {details ? <ServiceDisclosureEditor key={details.disclosure?.version ?? 0} organizationId={options.organizationId} customerId={options.customerId} customerName={details.customerName} organizationName={details.organizationName} timezone={details.timezone} engagement={item} mayManage={options.mayManage} relationshipEnded={relationship?.status === 'ended'} disclosure={details.disclosure} history={details.history} deliverables={details.deliverables} approvedDeliverables={details.approvedDeliverables} notificationDetails={details} onSaved={refreshDisclosure}/> : null}
    {details ? <ServiceReviewSection organizationId={options.organizationId} customerId={options.customerId} engagementId={item.id} disclosure={details.disclosure} history={details.history} reviews={details.reviews} timezone={details.timezone} mayManage={options.mayManage} mayReadSupport={details.mayReadSupport} relationshipEnded={relationship?.status === 'ended'} notificationDetails={details} onSaved={refreshDisclosure}/> : null}
    {details && options.mayManage ? <ServiceNotificationSection organizationId={options.organizationId} customerId={options.customerId} details={details} onSaved={refreshDisclosure}/> : null}
    {details?.mayReadSupport ? <ButtonLink tone="text" href={`/organizations/${options.organizationId}/support/cases?customer=${options.customerId}`}>Customer Support Cases</ButtonLink> : null}
    {options.mayManage && open && !item.relationship_id ? <form action={action} className="space-y-3"><ContextInputs {...options} engagementId={item.id}/><input type="hidden" name="operation" value="bind"/>
      <FormField id={`${id}-tenant`} label="Linked organization">{props => <SelectInput {...props} name="relationshipId" required defaultValue=""><option value="" disabled>Select linked organization</option>{options.relationships.filter(r => r.status === 'active').map(r => <option key={r.id} value={r.id}>{r.tenant_name}</option>)}</SelectInput>}</FormField><Button type="submit" disabled={pending}>Associate tenant</Button>
    </form> : null}
    <Section><SectionHeading>Deliverables</SectionHeading>
      {!details && !error ? <p role="status" className="text-sm text-muted">Loading deliverables…</p> : null}
      {details?.deliverables.length ? <ul className="space-y-3">{details.deliverables.map(d => {
        const href = d.available ? artifactHref(d.tenant_organization_id, d.kind, d.artifact_id) : null;
        return <li key={d.id} className="space-y-1"><p className="font-medium">{d.label}</p><p className="text-sm text-muted">{ARTIFACT_KINDS[d.kind as keyof typeof ARTIFACT_KINDS]} · {d.artifact_status}</p>{href ? <ButtonLink tone="text" href={href}>Open {ARTIFACT_KINDS[d.kind as keyof typeof ARTIFACT_KINDS]}</ButtonLink> : null}</li>;
      })}</ul> : details ? <p className="text-sm text-muted">No deliverables yet.</p> : null}
      {options.mayManage && open && relationship?.status === 'active' && details ? <div className="mt-4 space-y-3">
        <form onSubmit={event => { event.preventDefault(); setQuery(search); }} className="flex flex-wrap items-end gap-2">
          <FormField id={`${id}-search`} label="Find artifact">{props => <TextInput {...props} value={search} onChange={event => setSearch(event.target.value)} maxLength={100}/>}</FormField><Button type="submit" tone="secondary">Search</Button>
        </form>
        {details.options.length ? <form action={action} className="space-y-3"><ContextInputs {...options} engagementId={item.id}/><input type="hidden" name="operation" value="attach"/>
          <FormField id={`${id}-artifact`} label="Existing artifact">{props => <SelectInput {...props} name="artifact" required defaultValue=""><option value="" disabled>Select artifact</option>{details.options.map(a => <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>{ARTIFACT_KINDS[a.kind as keyof typeof ARTIFACT_KINDS]} · {a.label}</option>)}</SelectInput>}</FormField>
          {details.options.length === 100 ? <p className="text-sm text-muted">First 100 matches. Refine the search.</p> : null}
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Attach deliverable'}</Button>
        </form> : <p className="text-sm text-muted">No authorized artifacts available. Tenant access and the owning workspace’s permissions are required.</p>}
      </div> : null}
    </Section>
    <Section><SectionHeading>Work</SectionHeading>
      {details?.workIds.length ? <ul className="space-y-2">{details.workIds.map(workId => {
        const work = options.work.find(w => w.id === workId);
        return <li key={workId}>{work ? <ButtonLink tone="text" href={`/organizations/${options.organizationId}/work/${work.id}`}>{work.title}</ButtonLink> : <span className="text-sm text-muted">Work access required</span>}</li>;
      })}</ul> : <p className="text-sm text-muted">No related Work Items.</p>}
      {options.mayManage && open && options.work.length ? <form action={action} className="mt-4 space-y-3"><ContextInputs {...options} engagementId={item.id}/><input type="hidden" name="operation" value="work"/>
        <FormField id={`${id}-work`} label="Customer Work Item">{props => <SelectInput {...props} name="workItemId" required defaultValue=""><option value="" disabled>Select Work Item</option>{options.work.filter(w => !details?.workIds.includes(w.id)).map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</SelectInput>}</FormField><Button type="submit" disabled={pending}>Attach Work Item</Button>
      </form> : null}
    </Section>
    {terms ? <details><summary className="cursor-pointer text-sm">Accepted commercial terms</summary><div className="mt-2 space-y-1 text-sm"><p>{typeof terms.planLabel === 'string' ? terms.planLabel : 'Accepted proposal'}</p><p className="text-muted">Version {typeof terms.version === 'number' ? terms.version : 'unknown'} · {typeof terms.currency === 'string' ? terms.currency : 'Currency unavailable'}</p><p className="text-muted">Terms retained at engagement creation.</p></div></details> : null}
    {options.mayManage && open ? <details><summary className="cursor-pointer text-sm">Manage engagement</summary><form action={action} className="mt-3 space-y-3"><ContextInputs {...options} engagementId={item.id}/><input type="hidden" name="operation" value="transition"/>
      <p className="text-sm text-muted">Completion and cancellation retain history. Tenant artifacts have separate controls.</p>
      <FormField id={`${id}-status`} label="Engagement status">{props => <SelectInput {...props} name="status" defaultValue={item.status === 'planned' ? 'active' : 'completed'}>{item.status === 'planned' ? <option value="active">Active</option> : null}<option value="completed">Completed</option><option value="cancelled">Cancelled</option></SelectInput>}</FormField>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Update engagement'}</Button>
    </form></details> : null}
  </div>;
}

function EngagementDrawer({ item, options }: { item?: Engagement; options: Options }) {
  const [open, setOpen] = useState(false);
  return <PageDrawer open={open} onOpenChange={setOpen}><PageDrawerTrigger asChild><Button tone={item ? 'text' : 'primary'}>{item ? 'View engagement' : 'Add engagement'}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{item?.name ?? 'New engagement'}</PageDrawerTitle></PageDrawerHeader>
      {open ? item ? <EngagementDetails item={item} options={options}/> : <NewEngagement options={options} onSaved={() => setOpen(false)}/> : null}
    </PageDrawerContent>
  </PageDrawer>;
}

export function ServiceEngagementSection({ items, total, ...options }: Options & { items: Engagement[]; total: number | null }) {
  return <Section><div className="flex flex-wrap items-center justify-between gap-3"><SectionHeading><BusinessLabel>Services</BusinessLabel></SectionHeading>{options.mayManage ? <EngagementDrawer options={options}/> : null}</div>
    {items.length ? <ul className="divide-y divide-border">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{item.name}</p><p className="text-sm capitalize text-muted">{item.status} · {SERVICE_KINDS[item.service_kind as keyof typeof SERVICE_KINDS]}</p></div><EngagementDrawer item={item} options={options}/></li>)}</ul> : <p className="text-sm text-muted">No service engagements yet.</p>}
    {total !== null && total > items.length ? <p className="text-sm text-muted">Showing {items.length} of {total} engagements.</p> : null}
  </Section>;
}
