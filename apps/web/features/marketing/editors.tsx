'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { FormError } from '@/components/controls/form';
import { PageDrawer, PageDrawerTrigger, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerDescription, PageDrawerBody, PageDrawerFooter, PageDrawerClose } from '@/components/panels/page-drawer';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/controls/confirm-submit';
import { marketingCommandAction, previewAudienceAction, inspectInquiryAction, searchMarketingCustomersAction } from '@/app/organizations/[organizationId]/marketing/actions';
import { OBJECTIVES, TRANSITIONS, type Campaign, type Audience, type InquiryDetail, type MarketingData } from '@/lib/domain/marketing/marketing';
import type { Json } from '@/lib/db/database.types';

const control = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>; }

export function CampaignEditor({ organizationId, members, campaign, defaultOpen = false }: { organizationId: string; members: MarketingData['members']; campaign?: Campaign; defaultOpen?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(() => defaultOpen ? crypto.randomUUID() : null);
  return <PageDrawer open={open} onOpenChange={(value) => { setOpen(value); if (value && !requestId) setRequestId(crypto.randomUUID()); }}>
    <PageDrawerTrigger asChild><Button tone={campaign ? 'secondary' : 'primary'} size="small">{campaign ? 'Edit campaign' : '+ New campaign'}</Button></PageDrawerTrigger>
    <PageDrawerContent>
      <PageDrawerHeader><PageDrawerTitle>{campaign ? 'Edit campaign' : 'New campaign'}</PageDrawerTitle><PageDrawerDescription>Plan the objective and timing. Assemble audiences and acquisition sources in the campaign.</PageDrawerDescription></PageDrawerHeader>
      <PageDrawerBody><form id={id} className="grid gap-4" onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget); setError(null);
        start(async () => {
          const result = await marketingCommandAction(organizationId, campaign ? 'campaign.edit' : 'campaign.create', {
            id: campaign?.id ?? requestId, name: String(f.get('name')), objective: String(f.get('objective')), description: String(f.get('description')),
            start: String(f.get('start')), end: String(f.get('end')), owner: String(f.get('owner')), channels: f.getAll('channels').map(String),
          });
          if (result.error) setError(result.error);
          else { setOpen(false); toast.success(campaign ? 'Campaign saved' : 'Campaign created'); router.push(`/organizations/${organizationId}/marketing/campaigns/${result.id}`); router.refresh(); }
        });
      }}>
        <Field label="Campaign name"><TextInput name="name" defaultValue={campaign?.name} required maxLength={160} autoFocus /></Field>
        <Field label="Objective"><SelectInput name="objective" defaultValue={campaign?.objective ?? 'lead_generation'}>{Object.entries(OBJECTIVES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectInput></Field>
        <Field label="Description"><textarea className={control} rows={4} name="description" maxLength={4000} defaultValue={campaign?.description} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Planned start"><TextInput type="date" name="start" defaultValue={campaign?.planned_start_on ?? ''} /></Field><Field label="Planned end"><TextInput type="date" name="end" defaultValue={campaign?.planned_end_on ?? ''} /></Field></div>
        <Field label="Owner"><SelectInput name="owner" defaultValue={campaign?.owner_membership_id ?? ''}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</SelectInput></Field>
        <fieldset className="grid gap-2 text-sm"><legend className="mb-2 font-medium">Planned channels</legend>{['website', 'form', 'email', 'sms', 'manual'].map(channel => <label className="flex items-center gap-2 capitalize" key={channel}><input type="checkbox" name="channels" value={channel} defaultChecked={campaign?.channels.includes(channel)} />{channel}</label>)}</fieldset>
        <p className="text-xs text-muted">Activation tracks campaign intent. Promotional delivery is unavailable.</p><FormError>{error}</FormError>
      </form></PageDrawerBody>
      <PageDrawerFooter><PageDrawerClose asChild><Button tone="secondary" disabled={pending}>Cancel</Button></PageDrawerClose><Button form={id} disabled={pending}>{pending ? 'Saving…' : campaign ? 'Save campaign' : 'Create draft'}</Button></PageDrawerFooter>
    </PageDrawerContent>
  </PageDrawer>;
}

const TRANSITION_LABELS: Record<string, string> = { active: 'Activate', paused: 'Pause', completed: 'Complete', archived: 'Archive', draft: 'Draft' };

/**
 * A status change is one consequential decision, so it is confirmed in the shared Dialog rather than
 * a full-height drawer that held one sentence. The command, its domain validation and its refusal
 * are unchanged; a refusal stays in the dialog, and closing it returns focus to the button that
 * opened it. Radix returns focus only to its own trigger, and these buttons are not one, so the
 * opener is remembered here.
 */
export function Lifecycle({ organizationId, campaign }: { organizationId: string; campaign: Campaign }) {
  const [target, setTarget] = useState(''); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null); const router = useRouter();
  const label = TRANSITION_LABELS[target] ?? 'Confirm';
  const opener = useRef<HTMLButtonElement | null>(null);
  return <div className="flex flex-wrap items-center gap-2">
    {TRANSITIONS[campaign.status].map(status => <Button key={status} tone="secondary" size="small" onClick={(event) => { opener.current = event.currentTarget; setError(null); setTarget(status); }}>{TRANSITION_LABELS[status]}</Button>)}
    <Dialog open={!!target} onOpenChange={open => { if (!open && !pending) setTarget(''); }}>
      <DialogContent onCloseAutoFocus={(event) => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
        <DialogHeader><DialogTitle>{label} campaign?</DialogTitle><DialogDescription>Set {campaign.name} to {target.replaceAll('_', ' ')}. Activating a campaign enables its tracked Form links; it does not send messages.</DialogDescription></DialogHeader>
        <FormError>{error}</FormError>
        <DialogFooter><DialogClose asChild><Button tone="secondary" size="small" disabled={pending}>Cancel</Button></DialogClose><Button size="small" disabled={pending} onClick={() => start(async () => { const r = await marketingCommandAction(organizationId, 'campaign.status', { id: campaign.id, status: target }); if (r.error) setError(r.error); else { setTarget(''); toast.success('Campaign status updated'); router.refresh(); } })}>{pending ? 'Updating…' : label}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

export function Association({ organizationId, campaign, kind, options }: { organizationId: string; campaign: Campaign; kind: 'form' | 'audience'; options: { id: string; name: string }[] }) {
  const [value, setValue] = useState(''); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null); const router = useRouter();
  return <form className="grid gap-2 border-t border-border p-3" onSubmit={e => { e.preventDefault(); start(async () => { const r = await marketingCommandAction(organizationId, `campaign.${kind}`, { id: campaign.id, [kind]: value }); if (r.error) setError(r.error); else { setValue(''); toast.success(`${kind === 'form' ? 'Form' : 'Audience'} linked`); router.refresh(); } }); }}><div className="flex gap-2"><SelectInput aria-label={`Select ${kind}`} value={value} onChange={e => setValue(e.target.value)}><option value="">Select {kind}</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</SelectInput><Button size="small" tone="secondary" disabled={!value || pending}>Associate</Button></div><FormError>{error}</FormError></form>;
}

export function LandingPageSelector({ organizationId, campaign, options }: { organizationId: string; campaign: Campaign; options: MarketingData['available_pages'] }) {
  const [value, setValue] = useState(''); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null); const router = useRouter();
  return <form className="grid gap-2 border-t border-border p-3" onSubmit={e => {
    e.preventDefault(); const page = options.find(p => p.id === value); if (!page) return;
    start(async () => { const r = await marketingCommandAction(organizationId, 'campaign.page', { id: campaign.id, page: page.id, site: page.site, revision: page.revision }); if (r.error) setError(r.error); else { toast.success('Studio page associated'); router.refresh(); } });
  }}><div className="flex gap-2"><SelectInput aria-label="Published Studio landing page" value={value} onChange={e => setValue(e.target.value)}><option value="">Select a published landing page</option>{options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput><Button size="small" tone="secondary" disabled={!value || pending}>Link page</Button></div><FormError>{error}</FormError>{!options.length && <p className="text-xs text-muted">No published Studio pages available.</p>}</form>;
}

export function RemoveAssociation({ organizationId, campaignId, kind, id }: { organizationId: string; campaignId: string; kind: 'audience' | 'form'; id: string }) {
  const [pending, start] = useTransition(); const router = useRouter();
  return <Button size="tiny" tone="text" disabled={pending} onClick={() => start(async () => { const result = await marketingCommandAction(organizationId, `campaign.${kind}`, { id: campaignId, [kind]: id, remove: true }); if (result.error) toast.error(result.error); else { toast.success('Association removed'); router.refresh(); } })}>Remove association</Button>;
}

export function AcquisitionLink({ publicKey, token, campaignName }: { publicKey: string; token: string; campaignName: string }) {
  const [source, setSource] = useState(''); const [medium, setMedium] = useState(''); const [content, setContent] = useState(''); const [term, setTerm] = useState('');
  const query = new URLSearchParams({ campaign_token: token, utm_campaign: campaignName });
  for (const [key, value] of [['utm_source', source], ['utm_medium', medium], ['utm_content', content], ['utm_term', term]]) if (value) query.set(key, value);
  const path = `/f/${publicKey}?${query}`;
  return <div className="grid gap-3 border-t border-border p-3"><div className="grid grid-cols-2 gap-2">{[['Source', source, setSource], ['Medium', medium, setMedium], ['Content', content, setContent], ['Term', term, setTerm]].map(([label, value, setter]) => <Field key={String(label)} label={`UTM ${label}`}><TextInput maxLength={200} value={value as string} onChange={e => (setter as (value: string) => void)(e.target.value)} /></Field>)}</div><p className="break-all rounded border border-border bg-surface p-2 text-xs">{path}</p><div className="flex gap-2"><Button tone="secondary" size="small" onClick={async () => { try { await navigator.clipboard.writeText(new URL(path, window.location.origin).href); toast.success('Acquisition link copied'); } catch { toast.error('Copy failed. Select and copy the link above.'); } }}>Copy acquisition link</Button><Link className="text-sm text-accent-text" href={path} target="_blank">Open form</Link></div></div>;
}

export function AudienceEditor({ organizationId, stages, audience, mayManage }: { organizationId: string; stages: MarketingData['stages']; audience?: Audience; mayManage: boolean }) {
  const [open, setOpen] = useState(false); const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ total: number; customers: { id: string; name: string }[] } | null>(null); const id = useId(); const router = useRouter();
  return <PageDrawer open={open} onOpenChange={setOpen}><PageDrawerTrigger asChild><Button tone={audience ? 'secondary' : 'primary'} size="small">{audience ? 'Inspect segment' : '+ New audience'}</Button></PageDrawerTrigger><PageDrawerContent>
    <PageDrawerHeader><PageDrawerTitle>{audience?.name ?? 'New audience'}</PageDrawerTitle><PageDrawerDescription>Dynamic filters over canonical CRM Customers. Membership does not imply permission to contact.</PageDrawerDescription></PageDrawerHeader>
    <PageDrawerBody><form id={id} className="grid gap-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => { const r = await marketingCommandAction(organizationId, 'audience.save', { id: audience?.id, name: String(f.get('name')), description: String(f.get('description')), stage: String(f.get('stage')), from: String(f.get('from')), before: String(f.get('before')) }); if (r.error) setError(r.error); else { toast.success('Audience saved'); setOpen(false); router.refresh(); } }); }}>
      <Field label="Audience name"><TextInput name="name" defaultValue={audience?.name} required maxLength={160} disabled={!mayManage} /></Field>
      <Field label="Description"><textarea className={control} name="description" maxLength={2000} defaultValue={audience?.description} disabled={!mayManage} /></Field>
      <Field label="Customer relationship stage"><SelectInput name="stage" defaultValue={audience?.stage_id ?? ''} disabled={!mayManage}><option value="">Any stage</option>{stages.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</SelectInput></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Created on or after"><TextInput type="date" name="from" defaultValue={audience?.created_from ?? ''} disabled={!mayManage} /></Field><Field label="Created on or before"><TextInput type="date" name="before" defaultValue={audience?.created_before ?? ''} disabled={!mayManage} /></Field></div><FormError>{error}</FormError>
    </form>{audience && <div className="mt-5 grid gap-3 border-t border-border pt-4"><Button tone="secondary" size="small" disabled={pending} onClick={() => start(async () => { try { setPreview(await previewAudienceAction(organizationId, audience.id)); } catch (e) { setError(e instanceof Error ? e.message : 'Preview unavailable'); } })}>Refresh saved audience preview</Button>{preview && <><p className="text-sm">{preview.total} matching Customers · showing up to 25</p>{preview.customers.map(c => <Link className="text-sm text-accent-text" key={c.id} href={`/organizations/${organizationId}/crm/contacts/${c.id}`}>{c.name}</Link>)}{!preview.total && <p className="text-sm text-muted">No Customers match the saved criteria.</p>}</>}</div>}</PageDrawerBody>
    <PageDrawerFooter><PageDrawerClose asChild><Button tone="secondary">Close</Button></PageDrawerClose>{mayManage && <Button form={id} disabled={pending}>{pending ? 'Saving…' : 'Save audience'}</Button>}</PageDrawerFooter>
  </PageDrawerContent></PageDrawer>;
}

export function LeadInspector({ organizationId, timezone, inquiryId, mayManage, mayStudio, mayCreateCustomer, onClose }: { organizationId: string; timezone: string; inquiryId: string; mayManage: boolean; mayStudio: boolean; mayCreateCustomer: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InquiryDetail | null>(null); const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition(); const [search, setSearch] = useState(''); const [customers, setCustomers] = useState<{ id: string; name: string; email: string | null }[]>([]); const [customer, setCustomer] = useState(''); const [create, setCreate] = useState(false); const router = useRouter(); const formId = useId();
  useEffect(() => {
    let current = true;
    inspectInquiryAction(organizationId, inquiryId).then(value => { if (current) setDetail(value); }).catch(e => { if (current) setError(e instanceof Error ? e.message : 'Inquiry unavailable'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organizationId, inquiryId]);
  const change = (command: string, input: Record<string, Json | undefined>) => start(async () => { setError(null); const r = await marketingCommandAction(organizationId, command, { id: inquiryId, ...input }); if(r.error) setError(r.error); else { setDetail(await inspectInquiryAction(organizationId, inquiryId)); toast.success('Inquiry updated'); router.refresh(); } });
  const locked = !mayManage || !detail || ['handed_off', 'disqualified'].includes(detail.status);
  return <PageDrawer open onOpenChange={open => { if (!open) onClose(); }}><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Review inquiry</PageDrawerTitle><PageDrawerDescription>Inspect the original response and explicitly hand qualified interest into CRM.</PageDrawerDescription></PageDrawerHeader><PageDrawerBody>
    <FormError>{error}</FormError>{!detail ? <p role="status">{loading ? 'Loading inquiry…' : 'Inquiry unavailable.'}</p> : <div className="grid gap-5">
      <div className="rounded-md border border-border p-3 text-sm"><p className="font-semibold">{detail.form_name_at_capture}</p><p>{detail.campaign_name_at_capture ?? 'Unattributed'} · {detail.status.replaceAll('_', ' ')}</p><p className="mt-2 text-xs text-muted">Captured campaign and form names are historical source context.</p>{Object.entries(detail.source_context).filter(([k]) => k.startsWith('utm_')).map(([k, v]) => <p key={k} className="break-all text-xs">{k}: {v}</p>)}</div>
      <div className="text-xs text-muted"><p>Submitted {new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(detail.occurred_at))} · {detail.source}</p><p className="mt-1 break-all">Original submission: {detail.submission_id}</p></div>
      <section className="grid gap-3"><h3 className="text-sm font-semibold">Submitted information</h3>{detail.definition.fields.map(field => <div key={field.id} className="border-b border-border pb-2 text-sm"><p className="text-xs text-muted">{field.label}</p><p className="break-words">{String(Array.isArray(detail.answers[field.id]) ? (detail.answers[field.id] as string[]).join(', ') : detail.answers[field.id] ?? 'Not provided')}</p></div>)}</section>
      {mayStudio && <Link className="text-sm text-accent-text" href={`/organizations/${organizationId}/studio/forms/${detail.form_id}/submissions?submission=${detail.submission_id}`}>Open original Studio submissions</Link>}
      {detail.customer_id && <Link className="rounded border border-border p-3 text-sm text-accent-text" href={`/organizations/${organizationId}/crm/contacts/${detail.customer_id}`}>Open CRM Customer: {detail.customer_name ?? 'Linked Customer'}</Link>}
      {!locked && <><div className="flex flex-wrap gap-2"><Button size="small" tone="secondary" disabled={pending || detail.status === 'in_review'} onClick={() => change('inquiry.review', { status: 'in_review' })}>Start review</Button><Button size="small" tone="secondary" disabled={pending} onClick={() => change('inquiry.review', { status: 'disqualified' })}>Disqualify</Button></div>
        <section className="grid gap-3 border-t border-border pt-4"><h3 className="font-semibold">CRM handoff</h3><form className="flex gap-2" onSubmit={e => { e.preventDefault(); start(async () => { try { setCustomers(await searchMarketingCustomersAction(organizationId, search)); } catch(e) { setError(e instanceof Error ? e.message : 'Search failed'); } }); }}><TextInput aria-label="Search existing Customers" placeholder="Find an existing Customer" value={search} onChange={e => setSearch(e.target.value)} /><Button tone="secondary" size="small" disabled={pending}>Search</Button></form>
        <SelectInput aria-label="Existing Customer" value={customer} onChange={e => { setCustomer(e.target.value); setCreate(false); }}><option value="">{detail.customer_id ? 'Use linked Customer' : 'Select Customer'}</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}</SelectInput>
        <Button tone="secondary" size="small" disabled={!customer || pending} onClick={() => change('inquiry.link', { customer })}>Link selected Customer</Button>
        {mayCreateCustomer && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={create} onChange={e => { setCreate(e.target.checked); setCustomer(''); }} />Explicitly create a new CRM Customer</label>}
        <form id={formId} className="grid gap-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); change('inquiry.handoff', { customer: customer || detail.customer_id, create, name: String(f.get('name') ?? ''), email: String(f.get('email') ?? ''), phone: String(f.get('phone') ?? '') }); }}>
          {create && <><p className="text-xs text-muted">Enter the contact fields you have reviewed. Other answers stay in Studio.</p><Field label="Customer name"><TextInput name="name" required maxLength={200} /></Field><Field label="Email"><TextInput name="email" type="email" /></Field><Field label="Phone"><PhoneInput name="phone" type="tel" /></Field></>}
          <Button disabled={pending || (!create && !customer && !detail.customer_id)}>{pending ? 'Saving…' : create ? 'Create Customer and hand off' : 'Confirm CRM handoff'}</Button>
        </form></section></>}
    </div>}
  </PageDrawerBody><PageDrawerFooter><PageDrawerClose asChild><Button tone="secondary">Close</Button></PageDrawerClose></PageDrawerFooter></PageDrawerContent></PageDrawer>;
}
