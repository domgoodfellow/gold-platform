import type { ReactNode } from 'react';
import type { ApprovedService } from '@/lib/domain/customers/service-disclosures';
import { ServicePresentation } from '@/features/portal-access/service-presenter';
import { PORTAL_MODULES, portalPageHref, type PortalContent, type PortalPage, type PortalModule, type PortalModuleInstance } from '@/lib/domain/portal/composition';

export type PortalRecord = { id: string; title: string; detail: string; upcoming?: boolean; action?: ReactNode; /** An invoice's own PDF, offered whether or not the module takes payments. */ document?: ReactNode; service?: ApprovedService; timezone?: string };
export type PortalPresentation = Record<PortalModule, PortalRecord[]>;
export const PORTAL_PREVIEW_RECORDS: PortalPresentation = {
  services: [{id:'example-service',title:'Example website implementation',detail:'',service:{id:'example-service',title:'Example website implementation',serviceKind:'website',summary:'Example approved update: design prepared for review.',status:'Ready for review',publishedAt:'2026-10-14T12:00:00Z',deliverables:[{kind:'website',title:'Example website',summary:'Example deliverable presentation.',status:'Ready for review',url:null}]}}],
  work: [{ id: 'example-work', title: 'Example appointment', detail: 'Scheduled · Example date', upcoming: true }],
  invoices: [{ id: 'example-invoice', title: 'Example invoice #1001', detail: '$120.00 CAD due' }],
  forms: [{ id: 'example-form', title: 'Example customer information form', detail: 'Published Form offered to customers' }],
};

/** Shared between live Portal, the editor canvas, historical preview and template preview. */
export function PortalModulePresenter({ module, records, available = true, preview = false, unbounded = false }: { module: PortalModuleInstance; records: PortalRecord[]; available?: boolean; preview?: boolean; unbounded?: boolean }) {
  const shown = records.filter(record => module.kind !== 'work' || module.config.variant !== 'upcoming' || record.upcoming).slice(0, unbounded && !preview ? records.length : module.config.limit);
  return <section className="min-w-0 border-t border-border pt-4" data-portal-module={module.kind} data-portal-variant={module.config.variant}>
    <h2 className="break-words font-semibold">{module.config.heading}</h2>
    {!available && module.kind !== 'services' ? <p className="mt-2 text-sm text-muted">{PORTAL_MODULES[module.kind].label} is currently unavailable.</p> : !shown.length ? <p className="mt-2 text-sm text-muted">{module.kind === 'services' ? 'No approved service updates are currently shared.' : module.kind === 'forms' ? 'No Forms are currently offered.' : module.kind === 'invoices' ? 'Nothing invoiced yet.' : 'Nothing recorded yet.'}</p>
      : <ul className={module.config.variant === 'cards' ? 'mt-3 grid gap-3' : 'mt-2 divide-y divide-border'}>{shown.map(record => <li key={record.id} className={module.config.variant === 'cards' ? 'rounded-md border border-border p-3 text-sm' : 'py-3 text-sm'}>
        {module.kind === 'services' && record.service ? <ServicePresentation service={record.service} timezone={record.timezone} summary={module.config.variant === 'summary'}/> : <>{module.config.variant !== 'summary' && (module.kind !== 'forms' || preview || !record.action) ? <p className="break-words font-medium">{record.title}</p> : null}{record.detail ? <p className="mt-1 break-words whitespace-pre-line text-muted">{record.detail}</p> : null}</>}
        {!preview && module.kind === 'invoices' ? record.document : null}
        {!preview && (module.kind !== 'invoices' || module.config.payments) ? record.action : null}
      </li>)}</ul>}
  </section>;
}
// The domain registry names a closed presenter key; this adapter connects it to executable UI.
const MODULE_PRESENTERS: Record<PortalModule, typeof PortalModulePresenter> = {
  work: PortalModulePresenter, invoices: PortalModulePresenter, forms: PortalModulePresenter, services: PortalModulePresenter,
};
export function PortalRenderer({ content, page, records, available, preview = false, unbounded = false, onSelect, header }: {
  content: PortalContent; page: PortalPage; records: PortalPresentation; available?: Partial<Record<PortalModule, boolean>>;
  preview?: boolean; unbounded?: boolean; onSelect?: (id: string) => void; header?: ReactNode;
}) {
  return <div className={`mx-auto w-full max-w-2xl min-w-0 rounded-lg bg-surface p-4 sm:p-6 ${content.settings.layout === 'compact' ? 'space-y-3' : 'space-y-6'}`}>
    {header}
    {preview ? <p className="rounded-md border border-border p-2 text-xs text-muted">Preview — labelled example records. No customer session or live customer data.</p> : null}
    <nav aria-label="Portal pages" className="flex flex-wrap gap-3 text-sm">{content.navigation.map(entry => <a key={entry.pageId} aria-current={entry.pageId === page.id ? 'page' : undefined} href={preview ? '#portal-canvas' : portalPageHref(content.pages.find(item => item.id === entry.pageId)!, content)} onClick={preview ? event => { event.preventDefault(); onSelect?.(entry.pageId); } : undefined} className="rounded underline underline-offset-4">{entry.label}</a>)}</nav>
    <div><h1 className="break-words text-xl font-semibold">{content.settings.title}</h1>{content.settings.introduction ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{content.settings.introduction}</p> : null}{page.id !== content.defaultPageId ? <p className="mt-2 font-medium">{page.name}</p> : null}</div>
    {page.modules.map(module => {
      const Presenter=MODULE_PRESENTERS[PORTAL_MODULES[module.kind].presenter];
      return <Presenter key={module.id} module={module} records={records[module.kind]} available={available?.[module.kind] ?? true} preview={preview} unbounded={unbounded}/>;
    })}
  </div>;
}
