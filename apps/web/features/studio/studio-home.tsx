import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, ClipboardList, FileText, Globe, Layers, ShieldCheck } from 'lucide-react';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
import { ButtonLink } from '@/components/controls/button';
import { PreviewFrame } from '@/components/display/preview-frame';
import type { StudioOverview } from '@/lib/application/studio/studio-overview';
import { NewFormDrawer } from './forms/new-form-drawer';

function State({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{children}</span>;
}

export function StudioHome({ organizationId, timezone, mayManage, overview: data, configure }: { organizationId: string; timezone: string; mayManage: boolean; overview: StudioOverview; configure?: ReactNode }) {
  const base = `/organizations/${organizationId}`, studio = `${base}/studio`;
  const website = `${studio}/website`, forms = `${studio}/forms`, templates = `${studio}/templates`;
  const preview = data.website?.preview;
  const formatDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const websiteLabel = !data.website ? 'Restricted' : data.website.state === 'not_configured' ? 'Not created' : data.website.state === 'in_review' ? 'In review' : data.website.state === 'published' ? 'Published' : 'Draft';
  const cards = [
    { title: 'Website', value: websiteLabel, note: data.website?.working ? `Revision ${data.website.working.number} ${data.website.working.status === 'in_review' ? 'in review' : 'draft in progress'}` : preview ? `Revision ${preview.number}` : 'Create your customer-facing website', icon: Globe, href: website },
    { title: 'Forms', value: data.forms ? `${data.forms.total} active` : 'Restricted', note: data.forms ? `${data.forms.published} published · ${data.forms.withDraft} with drafts` : 'Organization management required', icon: FileText, href: forms },
    { title: 'Responses', value: data.forms ? String(data.forms.responses) : 'Restricted', note: 'All recorded form submissions', icon: ClipboardList, href: `${forms}?sort=responses` },
    { title: 'Public experience', value: data.publicUrl ? 'Website live' : 'Setup needed', note: data.booking.available ? 'Public booking available' : 'Review branding, address and booking', icon: ShieldCheck, href: `${base}/settings/organization` },
  ];
  const attentionHref = (key: string) => key.startsWith('website') ? website : key.startsWith('form') ? forms : key === 'brand-logo' ? `${base}/settings/branding` : key === 'profile-incomplete' ? `${base}/settings/public-profile` : key === 'no-bookable-type' ? `${base}/work/configuration` : `${base}/settings/organization`;
  return <AppPage className="@container/studio space-y-3">
    <PageHeader title="Studio" actions={<>
      {mayManage ? <><NewFormDrawer organizationId={organizationId} /><ButtonLink tone="secondary" href={website}>Edit website</ButtonLink></> : null}
      {preview ? <ButtonLink tone="secondary" href={`/preview/${organizationId}/${preview.id}`} target="_blank">Preview</ButtonLink> : null}
      {data.publicUrl ? <ButtonLink tone="secondary" href={data.publicUrl} target="_blank" rel="noreferrer">View site <ArrowUpRight aria-hidden className="size-4" /></ButtonLink> : null}
      {configure}
    </>} />
    <nav aria-label="Studio destinations" className="flex flex-wrap gap-4 text-xs font-medium text-accent-text underline decoration-border underline-offset-4">
      {[[website, 'Website'], [forms, 'Forms'], [templates, 'Templates']].map(([href, label]) => <Link key={href} href={href} className="hover:underline">{label}</Link>)}
    </nav>
    <div className="grid gap-3 sm:grid-cols-2 @min-[64rem]/studio:grid-cols-4">
      {cards.map(({ title, value, note, icon, href }) => <MetricTile key={title} label={title} value={value} detail={note} icon={icon} href={href} />)}
    </div>
    <div className="grid items-start gap-3 @min-[60rem]/studio:grid-cols-[minmax(0,2.5fr)_minmax(16rem,1fr)]">
      <div className="grid min-w-0 gap-3">
        <OperationalPanel title="Website overview">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><State>{websiteLabel}{preview ? ` · Revision ${preview.number}` : ''}</State><p className="mt-2 break-all text-xs text-muted">{data.hostname ?? 'A private preview is available without a public domain.'}</p></div>{mayManage ? <ButtonLink size="small" href={website}>{preview ? 'Open editor' : 'Create website'}</ButtonLink> : null}</div>
          <div className="max-h-96 overflow-hidden rounded-lg bg-secondary">
            {preview ? <PreviewFrame title="Website overview preview" src={`/preview/${organizationId}/${preview.id}`} /> : <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center"><Globe aria-hidden className="size-9 text-subtle" /><p className="font-medium">{mayManage ? 'Your website starts here' : 'Website preview is restricted'}</p><p className="text-sm text-muted">{mayManage ? 'Choose a starter or build a page from your own sections.' : 'An organization manager can author and preview the website.'}</p>{mayManage ? <ButtonLink size="small" href={templates}>Explore website templates</ButtonLink> : null}</div>}
          </div>
          {data.website?.working && data.website.state === 'published' ? <p className="mt-3 text-xs text-muted">Revision {data.website.working.number} is unpublished. Visitors still see Revision {data.website.revisionNumber}.</p> : null}
          {data.website?.publishedAt ? <p className="mt-2 text-xs text-muted">Published {formatDate(data.website.publishedAt)}</p> : null}
        </OperationalPanel>
        <OperationalPanel title="Forms & content" href={forms}>
          {data.formPreview.length ? <div className="divide-y divide-border">{data.formPreview.map((form) => <div key={form.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><div className="flex min-w-0 items-center gap-3"><FileText aria-hidden className="size-4 shrink-0 text-accent-text" /><div><Link href={`${forms}/${form.id}`} className="font-medium hover:underline">{form.name}</Link><p className="text-xs text-muted">{form.archived ? 'Archived' : form.publishedRevisionNumber ? `Published · Revision ${form.publishedRevisionNumber}${form.hasDraft ? ' · Draft in progress' : ''}` : 'Draft'}</p></div></div><Link href={`${forms}/${form.id}/submissions`} className="text-xs text-accent-text hover:underline">{form.submissionCount} responses</Link></div>)}</div> : <PanelState kind={data.forms ? 'empty' : 'restricted'} action={mayManage ? <NewFormDrawer organizationId={organizationId} /> : undefined}>{data.forms ? 'No forms yet. Start blank or choose a template.' : 'Your role cannot manage forms.'}</PanelState>}
        </OperationalPanel>
        <OperationalPanel title="Recent submissions" href={`${forms}?sort=responses`}>
          {data.recentResponses.length ? <ul className="divide-y divide-border">{data.recentResponses.map((response) => <li key={response.id}><Link href={`${forms}/${response.form_id}/submissions?submission=${response.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent-text"><span>{response.form_name}<span className="ml-2 text-xs text-muted">{response.source}</span></span><time className="text-xs text-muted" dateTime={response.submitted_at}>{formatDate(response.submitted_at)}</time></Link></li>)}</ul> : <PanelState kind={data.forms ? 'empty' : 'restricted'}>{data.forms ? 'No submissions received yet.' : 'Response access is restricted.'}</PanelState>}
        </OperationalPanel>
        <OperationalPanel title="Templates & creation" href={templates}><div className="grid gap-3 sm:grid-cols-3">{[['Website starters', 'A complete set of editable pages.', 'website'], ['Pages & sections', 'Build on your existing website.', 'pages'], ['Form templates', 'Start with useful questions.', 'forms']].map(([title, note, filter]) => <Link key={title} href={`${templates}?kind=${filter}`} className="rounded-md border border-border p-3 hover:bg-hover"><Layers aria-hidden className="mb-3 size-5 text-accent-text" /><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted">{note}</p></Link>)}</div></OperationalPanel>
      </div>
      <aside className="grid min-w-0 gap-3">
        <OperationalPanel title="Publishing status"><dl className="space-y-3 text-sm"><div className="flex justify-between gap-2"><dt className="text-muted">Website</dt><dd><State>{websiteLabel}</State></dd></div><div className="flex justify-between gap-2"><dt className="text-muted">Unpublished revision</dt><dd>{data.website?.working ? `Revision ${data.website.working.number}` : 'None'}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted">Forms with drafts</dt><dd>{data.forms?.withDraft ?? 'Restricted'}</dd></div></dl><div className="mt-3"><ButtonLink tone="text" size="small" href={website}>Review publishing & history</ButtonLink></div></OperationalPanel>
        <OperationalPanel title="Needs attention"><ul className="divide-y divide-border">{data.attention.length ? data.attention.map((item) => <li key={item.key}><Link href={attentionHref(item.key)} className="flex items-start gap-2 py-2.5 text-sm hover:underline"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />{item.label}</Link></li>) : <li><PanelState>Nothing needs attention.</PanelState></li>}</ul></OperationalPanel>
        {data.suggestions.length ? <OperationalPanel title="Suggestions"><ul className="divide-y divide-border">{data.suggestions.map((item) => <li key={item.key}><Link href={attentionHref(item.key)} className="block py-2.5 text-sm hover:underline">{item.label}</Link></li>)}</ul></OperationalPanel> : null}
        <OperationalPanel title="Public surfaces"><ul className="divide-y divide-border text-sm">{[
          ['Branding', data.brand.logoConfigured ? 'Logo configured' : 'No logo (optional)', `${base}/settings/branding`],
          ['Public address', data.hostname ?? 'Not configured', `${base}/settings/domains`],
          ['Booking', data.booking.available ? `${data.booking.bookableTypeCount} published types` : 'Setup needed', `${base}/work/configuration`],
          ['Customer portal', data.portal.activeInviteCount ? `${data.portal.activeInviteCount} customers invited` : 'No active invitations', `${base}/customers`],
        ].map(([label, value, href]) => <li key={label}><Link href={href} className="block py-2.5 hover:underline"><span className="font-medium">{label}</span><p className="mt-0.5 break-all text-xs text-muted">{value}</p></Link></li>)}</ul><p className="mt-2 text-xs text-muted">Invite customers to their portal from their Customer page.</p></OperationalPanel>
        <OperationalPanel title="Recent activity"><ul className="divide-y divide-border">{data.recentPublishing.length ? data.recentPublishing.map((revision) => <li key={revision.id}><Link href={`/preview/${organizationId}/${revision.id}`} target="_blank" className="flex justify-between gap-2 py-2.5 text-sm hover:text-accent-text"><span>Website revision {revision.number}</span><State>{revision.status.replace('_', ' ')}</State></Link></li>) : <li><PanelState>No website revisions yet.</PanelState></li>}</ul></OperationalPanel>
      </aside>
    </div>
  </AppPage>;
}
