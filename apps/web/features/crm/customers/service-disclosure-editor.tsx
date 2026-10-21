'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { disclosureAction, type ServiceActionState } from '@/app/organizations/[organizationId]/customers/[customerId]/service-actions';
import { SERVICE_KINDS, type Deliverable, type Engagement } from '@/lib/domain/customers/service-engagements';
import { parseDisclosureContent, type ApprovedDeliverable, type DisclosureContent, type DisclosureRevision, type ServiceDisclosure } from '@/lib/domain/customers/service-disclosures';
import { ServicePresentation } from '@/features/portal-access/service-presenter';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { NotificationChoice } from './service-notification-section';
import type { readEngagementDetails } from '@/app/organizations/[organizationId]/customers/[customerId]/service-actions';

type Props = {
  organizationId: string; customerId: string; customerName: string; organizationName: string; timezone?: string;
  engagement: Engagement; mayManage: boolean; relationshipEnded: boolean;
  disclosure: ServiceDisclosure | null; history: DisclosureRevision[];
  deliverables: Deliverable[]; approvedDeliverables: ApprovedDeliverable[]; onSaved: () => void;
  notificationDetails?: Awaited<ReturnType<typeof readEngagementDetails>>;
};
export function ServiceDisclosureEditor(props: Props) {
  const initial: DisclosureContent = props.disclosure ? parseDisclosureContent(props.disclosure.draft_content) : { title: '', serviceKind: props.engagement.service_kind as DisclosureContent['serviceKind'], summary: '', status: '', deliverables: [] };
  const [content, setContent] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<'draft' | 'published' | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const [state, action, pending] = useActionState(async (previous: ServiceActionState, form: FormData) => {
    const result = await disclosureAction(previous, form);
    if (result.saved) { props.onSaved(); setConfirm(null); setEditing(false); }
    return result;
  }, { error: null, saved: false });
  const id = useId();
  const published = props.history.find(item => item.id === props.disclosure?.published_revision_id);
  const dirty = JSON.stringify(initial) !== JSON.stringify(content);
  useUnsavedChanges(dirty);
  let valid = true;
  try { parseDisclosureContent(content); } catch { valid = false; }
  const previewContent = preview === 'published' && published ? parseDisclosureContent(published.content) : content;
  const draftDeliverables: ApprovedDeliverable[] = content.deliverables.map(item => ({ title: item.title, summary: item.summary, status: item.status, kind: props.deliverables.find(d => d.id === item.deliverableId)?.kind ?? '', url: null }));
  return <Section><SectionHeading>Customer-facing updates</SectionHeading>
    <p className="text-sm">{published ? 'Visible to customer' : props.disclosure ? 'Draft — Not visible to customer' : 'Not shared'}</p>
    {published ? <p className="text-xs text-muted">Published {new Date(published.published_at).toLocaleDateString('en-GB', { timeZone: props.timezone ?? 'UTC' })}</p> : null}
    {published && published.engagement_status !== props.engagement.status ? <p role="status" className="text-sm">Engagement status changed. Review the customer update.</p> : null}
    {props.relationshipEnded ? <p role="status" className="text-sm">Relationship ended. Customer-facing deliverables are suspended; the approved service summary remains visible until withdrawn.</p> : null}
    {published && JSON.stringify(published.content) !== JSON.stringify(initial) ? <p className="text-sm">Saved draft changes are not visible to the customer.</p> : null}
    <ErrorText role="alert">{state.error}</ErrorText>{state.saved ? <p role="status" className="text-sm">Customer update saved.</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {props.mayManage ? <Button type="button" tone="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : props.disclosure ? 'Edit customer update' : 'Prepare customer update'}</Button> : null}
      {published ? <Button type="button" tone="secondary" onClick={event => { previewTrigger.current = event.currentTarget; setPreview('published'); }}>Preview published update</Button> : null}
      {props.mayManage && props.disclosure ? <Button type="button" disabled={pending || dirty} onClick={event => { confirmationTrigger.current = event.currentTarget; setConfirm('publish'); }}>Publish update</Button> : null}
      {props.mayManage && published ? <Button type="button" tone="danger" disabled={pending || dirty} onClick={event => { confirmationTrigger.current = event.currentTarget; setConfirm('withdraw'); }}>Withdraw update</Button> : null}
    </div>
    {editing && props.mayManage ? <form action={action} className="mt-4 space-y-4">
      <Context props={props}/><input type="hidden" name="operation" value="save"/><input type="hidden" name="content" value={JSON.stringify(content)}/>
      <FormField id={`${id}-title`} label="Customer-facing title">{p => <TextInput {...p} required maxLength={200} value={content.title} onChange={event => setContent({ ...content, title: event.target.value })}/>}</FormField>
      <FormField id={`${id}-kind`} label="Service category">{p => <SelectInput {...p} value={content.serviceKind} onChange={event => setContent({ ...content, serviceKind: event.target.value as DisclosureContent['serviceKind'] })}>{Object.entries(SERVICE_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectInput>}</FormField>
      <FormField id={`${id}-summary`} label="Customer-facing description">{p => <TextArea {...p} required maxLength={3000} value={content.summary} onChange={event => setContent({ ...content, summary: event.target.value })}/>}</FormField>
      <FormField id={`${id}-status`} label="Approved progress">{p => <TextInput {...p} required maxLength={200} value={content.status} onChange={event => setContent({ ...content, status: event.target.value })}/>}</FormField>
      <details><summary className="cursor-pointer py-2 text-sm">Approved deliverables ({content.deliverables.length})</summary><div className="space-y-4">
        {props.deliverables.map(deliverable => {
          const item = content.deliverables.find(d => d.deliverableId === deliverable.id);
          const update = (patch: Partial<DisclosureContent['deliverables'][number]>) => setContent({ ...content, deliverables: content.deliverables.map(d => d.deliverableId === deliverable.id ? { ...d, ...patch } : d) });
          const prefix = `${id}-${deliverable.id}`;
          return <div key={deliverable.id} className="space-y-3"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!!item} disabled={!item && (!deliverable.available || content.deliverables.length >= 20)} onChange={event => setContent({ ...content, deliverables: event.target.checked ? [...content.deliverables, { deliverableId: deliverable.id, title: '', summary: '', status: '', shareLink: false }] : content.deliverables.filter(d => d.deliverableId !== deliverable.id) })}/>Share presentation for {deliverable.label}</label>
            <p className="text-xs text-muted">Internal: {deliverable.artifact_status}</p>
            {item ? <><FormField id={`${prefix}-title`} label="Deliverable title">{p => <TextInput {...p} required maxLength={200} value={item.title} onChange={e => update({ title: e.target.value })}/>}</FormField>
              <FormField id={`${prefix}-summary`} label="Deliverable description" optional>{p => <TextArea {...p} maxLength={1000} value={item.summary} onChange={e => update({ summary: e.target.value })}/>}</FormField>
              <FormField id={`${prefix}-status`} label="Deliverable progress">{p => <TextInput {...p} required maxLength={200} value={item.status} onChange={e => update({ status: e.target.value })}/>}</FormField>
              {['website', 'form', 'portal'].includes(deliverable.kind) ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={item.shareLink} onChange={e => update({ shareLink: e.target.checked })}/>Share verified public link</label> : null}
            </> : null}</div>;
        })}
        {!props.deliverables.length ? <p className="text-sm text-muted">Attach an authorized deliverable first, or publish a service summary without deliverables.</p> : null}
      </div></details>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || !valid}>{pending ? 'Saving…' : 'Save customer draft'}</Button><Button type="button" tone="secondary" disabled={!valid} onClick={event => { previewTrigger.current = event.currentTarget; setPreview('draft'); }}>Preview draft</Button></div>
    </form> : null}
    {confirm ? <form action={action} className="mt-4 space-y-3 rounded-md border border-border p-3"><Context props={props}/><input type="hidden" name="operation" value={confirm}/>
      <p>{confirm === 'publish' ? 'Release the saved customer update? Review the preview before publishing.' : 'Withdraw this update from the customer Portal? History will be retained.'}</p>
      {confirm === 'publish' ? <NotificationChoice configuration={props.notificationDetails?.notificationConfig} identities={props.notificationDetails?.emailIdentities} maySend={props.notificationDetails?.maySend} purpose="service_update_published"/> : null}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{confirm === 'publish' ? 'Confirm publication' : 'Confirm withdrawal'}</Button><Button type="button" tone="secondary" disabled={pending} onClick={() => { setConfirm(null); confirmationTrigger.current?.focus(); }}>Cancel</Button></div>
    </form> : null}
    {preview ? <div role="region" aria-label="Customer update preview" className="mt-4 space-y-3 rounded-md border border-border p-3">
      <p className="text-sm">Customer: {props.customerName} · Portal: {props.organizationName} · Mode: Preview ({preview})</p>
      {preview === 'draft' ? <p className="text-xs text-muted">Draft — Not visible to customer. Public destinations are validated on publication.</p> : null}
      <ServicePresentation timezone={props.timezone} service={{ id: 'preview', ...previewContent, publishedAt: published?.published_at ?? new Date().toISOString(), deliverables: preview === 'published' ? props.approvedDeliverables : draftDeliverables }}/>
      <Button type="button" tone="secondary" onClick={() => { setPreview(null); previewTrigger.current?.focus(); }}>Close preview</Button>
    </div> : null}
    {props.history.length ? <details className="mt-4"><summary className="cursor-pointer py-2 text-sm">Publication history</summary><ol className="space-y-2 text-sm">{props.history.map(revision => <li key={revision.id}>Revision {revision.number} · {new Date(revision.published_at).toLocaleString('en-GB', { timeZone: props.timezone ?? 'UTC' })}</li>)}</ol>{props.history.length === 50 ? <p className="text-xs text-muted">Showing the latest 50 releases.</p> : null}</details> : null}
  </Section>;
}
function Context({ props }: { props: Props }) {
  return <><input type="hidden" name="organizationId" value={props.organizationId}/><input type="hidden" name="customerId" value={props.customerId}/><input type="hidden" name="engagementId" value={props.engagement.id}/><input type="hidden" name="version" value={props.disclosure?.version ?? 0}/></>;
}
