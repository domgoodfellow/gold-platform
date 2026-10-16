import { ViewNav } from '@/components/navigation/view-nav';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { FinanceWorkflow } from '../finance-workflow';
import { InvoicesTable, QuotesTable, PaymentsTable } from './finance-tables';
import { financeFilters } from '@/lib/application/finance/operating';
import { readFinanceInvoices, readFinancePayments, readFinanceQuotes } from '@/lib/domain/billing/finance-reads';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { requireOrganization } from '@/lib/route/organization';

export async function FinanceCollection({ organizationId, kind, query }: { organizationId: string; kind: 'invoices' | 'quotes' | 'payments'; query: Record<string, string | string[] | undefined> }) {
  const { db, organization } = await requireOrganization(organizationId);
  const filter = financeFilters(query, organization.timezone);
  const [result, customers, modules] = await Promise.all([
    kind === 'invoices' ? readFinanceInvoices(db, organizationId, filter) : kind === 'quotes' ? readFinanceQuotes(db, organizationId, filter) : readFinancePayments(db, organizationId, filter),
    listCustomers(db, { organizationId }),
    listUsableModules(db, { organizationId }),
  ]);
  const base = `/organizations/${organizationId}/finance`, title = kind[0].toUpperCase() + kind.slice(1);
  const workflow = kind === 'invoices' ? 'invoice' : kind === 'quotes' ? 'quote' : 'payment';
  const may = (cap: (typeof organization.capabilities)[number]) => organization.capabilities.includes(cap);
  const canCreate = modules.has('billing') && may(kind === 'invoices' ? 'invoice.issue' : kind === 'quotes' ? 'work_item.price' : 'payment.record');
  const page = filter.page ?? 1;
  const href = (next: number) => { const p = new URLSearchParams(); for (const [k,v] of Object.entries(query)) if (typeof v === 'string' && k !== 'page') p.set(k,v); p.set('page', String(next)); return `${base}/${kind}?${p}`; };
  return <AppPage><CollectionHeader title={title} crumbs={[{ label: 'Finance', href: base }]} actions={canCreate ? <FinanceWorkflow organizationId={organizationId} kind={workflow} mayCreateWork={may('work_item.create')} /> : undefined} />
    <ViewNav label="Finance collections" className="mb-4" items={['quotes','invoices','payments'].map(k => ({ key: k, label: k[0].toUpperCase() + k.slice(1), href: `${base}/${k}`, current: k === kind }))} />
    <form className="mb-4 flex flex-wrap items-end gap-3">
      <FormField id="finance-search" label="Search">{field => <TextInput {...field} name="q" type="search" defaultValue={filter.q} placeholder="Customer, record or reference" />}</FormField>
      {kind !== 'payments' ? <FormField id="finance-status" label="Status">{field => <SelectInput {...field} name="status" defaultValue={filter.status}><option value="">All</option>{(kind === 'invoices' ? [['outstanding','Outstanding'],['overdue','Overdue'],['settled','Settled']] : [['not-invoiced','Not invoiced'],['invoiced','Invoiced']]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</SelectInput>}</FormField> : null}
      <FormField id="finance-customer" label="Customer">{field => <SelectInput {...field} name="customer" defaultValue={filter.customer ?? ''}><option value="">All customers</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectInput>}</FormField>
      <FormField id="finance-from" label="From">{field => <TextInput {...field} name="from" type="date" defaultValue={typeof query.from === 'string' ? query.from : ''} />}</FormField>
      <FormField id="finance-to" label="Before">{field => <TextInput {...field} name="to" type="date" defaultValue={typeof query.to === 'string' ? query.to : ''} />}</FormField>
      {kind === 'invoices' ? <FormField id="finance-due-on" label="Due on">{field => <TextInput {...field} name="due" type="date" defaultValue={typeof query.due === 'string' ? query.due : ''} />}</FormField> : null}
      <Button type="submit" tone="secondary">Filter</Button><ButtonLink tone="text" href={`${base}/${kind}`}>Reset</ButtonLink>
    </form>
    <div className="rounded-lg border border-border bg-surface p-3"><p className="mb-3 text-xs text-muted">{result.total} matching {kind} · {organization.timezone}</p>{kind === 'invoices' ? <InvoicesTable timezone={organization.timezone} organizationId={organizationId} rows={result.rows as Awaited<ReturnType<typeof readFinanceInvoices>>['rows']} empty="No matching invoices." mayRecord={modules.has('billing') && may('payment.record')} /> : kind === 'quotes' ? <QuotesTable organizationId={organizationId} rows={result.rows as Awaited<ReturnType<typeof readFinanceQuotes>>['rows']} empty="No matching priced Work." mayIssue={modules.has('billing') && may('invoice.issue')} /> : <PaymentsTable timezone={organization.timezone} organizationId={organizationId} rows={result.rows as Awaited<ReturnType<typeof readFinancePayments>>['rows']} empty="No matching payments." />}</div>
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">{page > 1 ? <ButtonLink href={href(page - 1)}>Previous</ButtonLink> : <span />}<span>Page {page} · {result.total} records</span>{page * 25 < result.total ? <ButtonLink href={href(page + 1)}>Next</ButtonLink> : <span />}</nav>
  </AppPage>;
}
