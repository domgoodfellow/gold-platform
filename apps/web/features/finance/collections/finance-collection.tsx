import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { CollectionToolbar, type ActiveFilter } from '@/components/patterns/collection-toolbar';
import { InvoiceDialog } from '../transactions/invoice-dialog';
import { PaymentDialog } from '../transactions/payment-dialog';
import { QuoteDialog } from '../transactions/quote-dialog';
import { InvoicesTable, QuotesTable, PaymentsTable } from './finance-tables';
import { financeFilters } from '@/lib/application/finance/operating';
import { readFinanceInvoice, readFinanceInvoices, readFinancePayments, readFinanceQuotes } from '@/lib/domain/billing/finance-reads';
import { getInvoice } from '@/lib/domain/billing/invoices';
import { getInvoiceDocumentRecord } from '@/lib/domain/billing/invoice-documents';
import { invoiceEmailState, listInvoiceEmails } from '@/lib/domain/billing/invoice-emails';
import { emailSendingStatus } from '@/lib/domain/email/sender';
import { inboxAvailable } from '@/lib/application/communications/inbox-availability';
import { InspectorFocusReturn, InvoiceInspector } from './invoice-inspector';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';

type Kind = 'invoices' | 'quotes' | 'payments';
const PAGE_SIZE = 25;
/** Each collection's quick scopes (one URL parameter), sort orders and the parameters its view keeps. */
const VIEW = {
  invoices: { scope: 'status', scopes: [['', 'All'], ['outstanding', 'Outstanding'], ['due-soon', 'Due soon'], ['overdue', 'Overdue'], ['settled', 'Settled']], sorts: [['', 'Newest first'], ['due', 'Due date'], ['outstanding', 'Largest balance'], ['customer', 'Customer']], keys: ['q', 'status', 'customer', 'from', 'to', 'due', 'sort'] },
  quotes: { scope: 'status', scopes: [['', 'All'], ['not-invoiced', 'Not invoiced'], ['invoiced', 'Invoiced']], sorts: [['', 'Newest first'], ['amount', 'Largest amount'], ['title', 'Work title']], keys: ['q', 'status', 'customer', 'from', 'to', 'sort'] },
  payments: { scope: 'entry', scopes: [['', 'All'], ['receipts', 'Receipts'], ['corrections', 'Corrections']], sorts: [['', 'Newest first'], ['oldest', 'Oldest first'], ['amount', 'Largest amount']], keys: ['q', 'entry', 'customer', 'source', 'from', 'to', 'sort'] },
} as const;
const TITLES = { invoices: 'Invoices', quotes: 'Quotes', payments: 'Payments' } as const;
const NOUN = { invoices: ['invoice', 'invoices'], quotes: ['priced Work item', 'priced Work items'], payments: ['payment entry', 'payment entries'] } as const;

/**
 * Quotes, Invoices and Payments share one collection grammar: quick scopes and search, then sort,
 * with less frequent criteria inside Filters, shown as removable chips with Reset. Everything is in
 * the URL and applied by the database, so the count, the rows and the pages always agree.
 */
export async function FinanceCollection({ organizationId, kind, query }: { organizationId: string; kind: Kind; query: Record<string, string | string[] | undefined> }) {
  const { db, organization } = await requireOrganization(organizationId);
  const filter = financeFilters(query, organization.timezone);
  const [result, customers, modules] = await Promise.all([
    kind === 'invoices' ? readFinanceInvoices(db, organizationId, filter) : kind === 'quotes' ? readFinanceQuotes(db, organizationId, filter) : readFinancePayments(db, organizationId, filter),
    listContacts(db, { organizationId }),
    listUsableModules(db, { organizationId }),
  ]);
  const base = `/organizations/${organizationId}/finance`, path = `${base}/${kind}`, view = VIEW[kind];
  const may = (cap: (typeof organization.capabilities)[number]) => organization.capabilities.includes(cap);
  const billing = modules.has('billing');
  const today = todayInZone(organization.timezone);
  const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const href = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const key of view.keys) { const next = key in overrides ? overrides[key] : value(key); if (next) params.set(key, next); }
    if (overrides.page && overrides.page !== '1') params.set('page', overrides.page);
    return `${path}${params.size ? `?${params}` : ''}`;
  };
  const scopeValue = value(view.scope);
  const scopes = view.scopes.map(([key, label]) => ({ key: key || 'all', label, href: href({ [view.scope]: key || undefined }), current: scopeValue === key }));
  const customerName = (id: string) => customers.find(customer => customer.id === id)?.name ?? 'Contact';
  const dateLabel = kind === 'payments' ? 'Received' : kind === 'quotes' ? 'Created' : 'Issued';
  const chips: [string, string, (v: string) => string][] = [
    ['customer', 'Contact', customerName], ['source', 'Source', v => v === 'manual' ? 'Recorded by hand' : 'Payment processor'],
    ['from', `${dateLabel} from`, v => v], ['to', `${dateLabel} before`, v => v], ['due', 'Due on', v => v],
  ];
  const active: ActiveFilter[] = [
    ...(filter.q ? [{ key: 'q', label: `Search: ${filter.q}`, removeHref: href({ q: undefined }) }] : []),
    ...chips.filter(([key]) => (view.keys as readonly string[]).includes(key) && value(key)).map(([key, label, show]) => ({ key, label: `${label}: ${show(value(key))}`, removeHref: href({ [key]: undefined }) })),
  ];
  const page = filter.page ?? 1, pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const create = !billing ? null
    : kind === 'invoices' && may('invoice.issue') ? <InvoiceDialog organizationId={organizationId} today={today} tone="primary" initiallyOpen={query.create === '1'} />
    : kind === 'quotes' && may('work_item.price') ? <QuoteDialog organizationId={organizationId} tone="primary" initiallyOpen={query.create === '1'} mayCreateWork={may('work_item.create')} mayManageCatalog={may('price.manage')} />
    : kind === 'payments' && may('payment.record') ? <PaymentDialog organizationId={organizationId} today={today} tone="primary" initiallyOpen={query.create === '1'} />
    : null;
  const [one, many] = NOUN[kind];
  // The inspector reads only when the address names an invoice, each time under this reader's own access.
  const inspected = kind === 'invoices' && value('invoice') ? await readFinanceInvoice(db, organizationId, value('invoice')) : null;
  const [inspectedInvoice, inspectedDocument] = inspected ? await Promise.all([getInvoice(db, { organizationId, invoiceId: inspected.id }), getInvoiceDocumentRecord(db, { organizationId, invoiceId: inspected.id })]) : [null, null];
  // Emailing needs both permissions and usable Billing; the database checks all three again at send.
  const mayEmail = billing && may('invoice.issue') && may('message.send');
  const [inspectedSends, sending] = inspected ? await Promise.all([
    listInvoiceEmails(db, { organizationId, invoiceId: inspected.id }),
    mayEmail ? emailSendingStatus(db, organizationId) : null,
  ]) : [[], null];
  // A send links to its conversation only where this person can open the Inbox, by the same predicate navigation uses.
  const inboxOpen = inspected && (mayEmail || inspectedSends.length > 0)
    ? await inboxAvailable(db, { organizationId, capabilities: organization.capabilities })
    : false;
  const here = href({ page: String(page) });
  const inspectHref = (invoiceId: string) => `${here}${here.includes('?') ? '&' : '?'}invoice=${invoiceId}`;
  const filtered = active.length > 0 || Boolean(scopeValue);
  return <AppPage>
    <CollectionHeader title={TITLES[kind]} crumbs={[{ label: 'Finance', href: base }]} actions={create ?? undefined} />
    <CollectionToolbar action={path} viewId={`finance-${kind}`} scopes={scopes} scopeLabel={`${TITLES[kind]} views`}
      search={{ name: 'q', value: filter.q, label: `Search ${TITLES[kind].toLowerCase()}`, placeholder: kind === 'quotes' ? 'Work title or contact' : kind === 'invoices' ? 'Contact or invoice number' : 'Contact, invoice number or reference' }}
      hidden={{ [view.scope]: scopeValue || undefined }}
      filterCount={active.filter(filter => filter.key !== 'q').length}
      filters={<>
        <label className="flex flex-col gap-1 text-sm">Contact<SelectInput name="customer" aria-label="Filter by contact" defaultValue={value('customer')}><option value="">Any contact</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SelectInput></label>
        {kind === 'payments' ? <label className="flex flex-col gap-1 text-sm">Source<SelectInput name="source" aria-label="Filter by source" defaultValue={value('source')}><option value="">Any source</option><option value="manual">Recorded by hand</option><option value="processor">Payment processor</option></SelectInput></label> : null}
        <label className="flex flex-col gap-1 text-sm">{dateLabel} from<TextInput name="from" type="date" aria-label={`${dateLabel} from`} defaultValue={value('from')} /></label>
        <label className="flex flex-col gap-1 text-sm">{dateLabel} before<TextInput name="to" type="date" aria-label={`${dateLabel} before`} defaultValue={value('to')} /></label>
        {kind === 'invoices' ? <label className="flex flex-col gap-1 text-sm">Due on<TextInput name="due" type="date" aria-label="Due on" defaultValue={value('due')} /></label> : null}
      </>}
      sort={<SelectInput name="sort" aria-label={`Sort ${TITLES[kind].toLowerCase()}`} defaultValue={value('sort')} className="w-full md:w-44">{view.sorts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectInput>}
      active={active} resetHref={filtered ? path : undefined} className="mb-4" />
    <section aria-label={`${TITLES[kind]} results`} className="min-w-0">
      <p role="status" className="mb-2 text-sm text-muted"><span className="font-medium text-foreground tabular-nums">{result.total}</span> {result.total === 1 ? one : many}{filtered ? ' match this view' : ''}</p>
      {kind === 'invoices' ? <InvoicesTable timezone={organization.timezone} organizationId={organizationId} today={today} inspectHref={inspectHref} rows={result.rows as Awaited<ReturnType<typeof readFinanceInvoices>>['rows']} empty={filtered ? 'No invoices match this view.' : 'No invoices issued yet. Invoices are issued from priced Work.'} mayRecord={billing && may('payment.record')} />
        : kind === 'quotes' ? <QuotesTable organizationId={organizationId} today={today} rows={result.rows as Awaited<ReturnType<typeof readFinanceQuotes>>['rows']} empty={filtered ? 'No priced Work matches this view.' : 'Nothing priced yet. A quote is a Work item with priced lines from your catalog.'} mayIssue={billing && may('invoice.issue')} />
        : <PaymentsTable timezone={organization.timezone} organizationId={organizationId} rows={result.rows as Awaited<ReturnType<typeof readFinancePayments>>['rows']} empty={filtered ? 'No payment entries match this view.' : 'No payments recorded yet. Payments are recorded against issued invoices.'} />}
    </section>
    {kind === 'invoices' ? <InspectorFocusReturn /> : null}
    {inspected && inspectedInvoice ? <InvoiceInspector key={inspected.id} organizationId={organizationId} row={inspected} invoice={inspectedInvoice} timezone={organization.timezone} today={today} closeHref={here} mayRecord={billing && may('payment.record')} document={{ available: Boolean(inspectedDocument), mayCreate: billing && may('invoice.issue') }}
      email={{ may: mayEmail, inboxOpen, senderProblem: sending && sending.state !== 'ready' ? sending.detail ?? 'This business cannot send email yet.' : null,
        sends: inspectedSends.map(send => ({ id: send.id, conversationId: send.conversationId, recipient: send.recipient, fromAddress: send.fromAddress, createdAt: send.createdAt, sentAgain: send.sentAgain, ...invoiceEmailState(send.status, send.failureReason) })) }} /> : null}
    {result.total > PAGE_SIZE || page > 1 ? <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      {page > 1 ? <ButtonLink tone="secondary" size="small" href={href({ page: String(page - 1) })}>Previous</ButtonLink> : <span />}
      <span className="tabular-nums text-muted">Page {page} of {pages} · {result.total} records</span>
      {page * PAGE_SIZE < result.total ? <ButtonLink tone="secondary" size="small" href={href({ page: String(page + 1) })}>Next</ButtonLink> : <span />}
    </nav> : null}
  </AppPage>;
}
