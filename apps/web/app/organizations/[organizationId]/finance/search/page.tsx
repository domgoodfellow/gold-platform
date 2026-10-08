import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { InvoicesTable, QuotesTable, PaymentsTable } from '@/features/finance/collections/finance-tables';
import { readFinanceInvoices, readFinanceQuotes, readFinancePayments } from '@/lib/domain/billing/finance-reads';
import { requireOrganization } from '@/lib/route/organization';

export default async function FinanceSearch({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/search'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const query = await searchParams, q = typeof query.q === 'string' ? query.q.slice(0,100) : '';
  const [invoices,quotes,payments] = await Promise.all([readFinanceInvoices(db,organizationId,{q,limit:5}),readFinanceQuotes(db,organizationId,{q,limit:5}),readFinancePayments(db,organizationId,{q,limit:5})]);
  const base = `/organizations/${organizationId}/finance`;
  return <AppPage><CollectionHeader title="Search Finance" crumbs={[{label:'Finance',href:base}]} /><form className="mb-4 flex gap-2"><TextInput name="q" type="search" aria-label="Search Finance" defaultValue={q} /><Button type="submit">Search</Button></form>{[['Invoices','invoices',invoices.total,<InvoicesTable timezone={organization.timezone} key="i" organizationId={organizationId} rows={invoices.rows} empty="No matching invoices." />],['Quotes','quotes',quotes.total,<QuotesTable key="q" organizationId={organizationId} rows={quotes.rows} empty="No matching quotes." />],['Payments','payments',payments.total,<PaymentsTable timezone={organization.timezone} key="p" organizationId={organizationId} rows={payments.rows} empty="No matching payments." />]].map(([label,path,count,table]) => <section key={String(path)} className="mb-3 rounded-lg border border-border p-3"><div className="mb-3 flex justify-between"><h2 className="font-semibold">{label} ({count})</h2><Link className="text-sm text-primary" href={`${base}/${path}?q=${encodeURIComponent(q)}`}>View all</Link></div>{table}</section>)}</AppPage>;
}
