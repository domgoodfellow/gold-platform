'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, CreditCard } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { FormField, FormError } from '@/components/controls/form';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { financeChoices, financeReview, financeMutation } from '@/app/organizations/[organizationId]/finance/actions';
import { invoiceStanding } from '@/lib/domain/billing/invoices';
import { priceWorkItem } from '@/lib/domain/pricing/prices';
import { formatMoney } from '@/lib/domain/work-items/consumption';

type Kind = 'invoice' | 'quote' | 'payment';
const labels = { invoice: 'New invoice', quote: 'New quote', payment: 'Record payment' };
export function FinanceWorkflow({ organizationId, kind, workItemId, compact = false, mayCreateWork = false }: { organizationId: string; kind: Kind; workItemId?: string; compact?: boolean; mayCreateWork?: boolean }) {
  const [open, setOpen] = useState(false);
  return <PageDrawer open={open} onOpenChange={setOpen}>
    <PageDrawerTrigger asChild><Button tone={kind === 'invoice' && !compact ? 'primary' : 'secondary'} size={compact ? 'tiny' : 'small'}>{kind === 'payment' ? <CreditCard aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}{labels[kind]}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{labels[kind]}</PageDrawerTitle></PageDrawerHeader>{open ? <WorkflowBody organizationId={organizationId} kind={kind} initialId={workItemId} mayCreateWork={mayCreateWork} /> : null}</PageDrawerContent>
  </PageDrawer>;
}

function WorkflowBody({ organizationId, kind, initialId, mayCreateWork }: { organizationId: string; kind: Kind; initialId?: string; mayCreateWork: boolean }) {
  const [q, setQ] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({ quantity: '1' });
  const control = (name: string) => ({ name, value: fields[name] ?? '', onChange: (event: { target: { value: string } }) => setFields(previous => ({ ...previous, [name]: event.target.value })) });
  const [selected, setSelected] = useState(initialId ?? '');
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof financeChoices>>>({ total: 0, rows: [] });
  const [review, setReview] = useState<Awaited<ReturnType<typeof financeReview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  const [state, action, pending] = useActionState(financeMutation, { error: null });
  useEffect(() => { let active = true; const timer = setTimeout(() => startTransition(async () => { try { const result = await financeChoices(organizationId, kind, q); if (active) { setChoices(result); setError(null); } } catch { if (active) setError('Could not load records. Try searching again.'); } }), 200); return () => { active = false; clearTimeout(timer); }; }, [organizationId, kind, q]);
  useEffect(() => { if (!selected) return; let active = true; startTransition(async () => { try { const result = await financeReview(organizationId, selected); if (active) { setReview(result); setError(null); } } catch { if (active) setError('Could not load financial details. Choose another record.'); } }); return () => { active = false; }; }, [organizationId, selected, state]);
  const total = review ? priceWorkItem(review.lines) : null;
  const standing = review?.invoice ? invoiceStanding(review.invoice) : null;
  return <div className="space-y-4">
    <p className="text-sm text-muted">{kind === 'invoice' ? 'Select priced Work, review its lines, then issue an immutable invoice.' : kind === 'quote' ? 'Select Work and add services from your price book.' : 'Select an invoice to record money received or an append-only correction.'}</p>
    {!initialId ? <><FormField id="finance-workflow-search" label="Find a record">{field => <TextInput {...field} value={q} onChange={e => setQ(e.target.value)} placeholder={kind === 'quote' ? 'Work title' : 'Customer or invoice number'} />}</FormField>
      <FormField id="finance-workflow-record" label={kind === 'payment' ? 'Invoice' : 'Work item'}>{field => <SelectInput {...field} value={selected} onChange={e => { setReview(null); setSelected(e.target.value); }}><option value="">Choose a record</option>{choices.rows.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</SelectInput>}</FormField>
      <p className="text-xs text-muted">{loading ? 'Loading…' : `${choices.total} matching records`}{choices.total > choices.rows.length ? ' · Showing the first 25. Refine your search.' : ''}</p></> : null}
    {kind === 'quote' && mayCreateWork ? <ButtonLink size="small" href={`/organizations/${organizationId}/work?create=1`}>Start new Work</ButtonLink> : null}
    <FormError>{error}</FormError>
    {review ? <>
      <div className="rounded-lg border border-border bg-surface p-3 text-sm"><p className="font-semibold">{review.work.title}</p><p className="text-muted">{review.work.customer?.label ?? 'No customer'}</p>
        {(kind === 'payment' ? review.invoice?.lines ?? [] : review.lines).map(l => <div key={l.id} className="flex justify-between gap-3 border-b border-border py-2"><span>{l.description} × {l.quantity}</span><span className="tabular-nums">{formatMoney(l.unitAmountMinor, l.currency)} / {l.unit}</span></div>)}
        {kind === 'payment' && review.invoice && standing ? <dl className="mt-3 grid grid-cols-3 gap-2"><div><dt className="text-muted">Invoice #{review.invoice.number}</dt><dd>{standing.total ? formatMoney(standing.total.totalMinor, review.invoice.currency) : 'Unknown'}</dd></div><div><dt className="text-muted">Paid</dt><dd>{formatMoney(standing.paidMinor, review.invoice.currency)}</dd></div><div><dt className="text-muted">Outstanding</dt><dd>{formatMoney(standing.outstandingMinor ?? 0, review.invoice.currency)}</dd></div></dl> : <p className="mt-3 font-semibold">Quoted total: {total ? formatMoney(total.totalMinor, total.currency) : 'Nothing priced yet'}</p>}
      </div>
      {kind === 'invoice' && review.invoice ? <p>This Work already has invoice #{review.invoice.number}.</p> : kind === 'invoice' && !total ? <p>Add pricing before issuing an invoice.</p> : kind === 'payment' && !review.invoice ? <p>No issued invoice exists for this Work.</p> : <form action={action} className="space-y-3">
        <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="workItemId" value={selected} /><input type="hidden" name="kind" value={kind} />
        {kind === 'invoice' ? <><FormField id="finance-issued" label="Invoice date" optional>{field => <TextInput {...field} type="date" {...control('issuedAt')} />}</FormField><FormField id="finance-due" label="Due date" optional>{field => <TextInput {...field} type="date" {...control('dueAt')} />}</FormField></> : kind === 'payment' ? <><FormField id="finance-amount" label={`Amount (${review.invoice!.currency})`}>{field => <TextInput {...field} {...control('amount')} required inputMode="decimal" placeholder="0.00" />}</FormField><FormField id="finance-received" label="Received date" optional>{field => <TextInput {...field} type="date" {...control('receivedAt')} />}</FormField><FormField id="finance-note" label="Note" optional>{field => <TextInput {...field} {...control('note')} maxLength={1000} />}</FormField><p className="text-xs text-muted">Use a negative amount for a refund or correction. Historical payments stay unchanged.</p></> : <><FormField id="finance-price" label="Price book item">{field => <SelectInput {...field} {...control('priceBookItemId')} required><option value="">Choose a service</option>{review.items.map(i => <option key={i.id} value={i.id}>{i.name} · {formatMoney(i.unitAmountMinor, i.currency)} / {i.unit}</option>)}</SelectInput>}</FormField><FormField id="finance-quantity" label="Quantity">{field => <TextInput {...field} {...control('quantity')} type="number" min={1} step={1} required />}</FormField>{!review.items.length ? <Link className="text-accent-text underline" href={`/organizations/${organizationId}/finance/configuration/pricing`}>Set up pricing</Link> : null}</>}
        <FormError>{state.error}</FormError><Button type="submit" disabled={pending || loading || (kind !== 'quote' && !!state.success)}>{pending ? 'Saving…' : kind === 'invoice' ? 'Confirm issue invoice' : kind === 'quote' ? 'Add to quote' : 'Save payment'}</Button>
      </form>}
      {state.success ? <div role="status" className="rounded border border-border p-3"><p>{state.success}</p><Link className="text-accent-text underline" href={kind === 'quote' ? `/organizations/${organizationId}/finance/quotes` : state.href!}>{kind === 'quote' ? 'View Quotes' : 'Open financial detail'}</Link></div> : null}
    </> : null}
  </div>;
}
