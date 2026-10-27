'use client';

import { useRef, useState, type ReactNode } from 'react';
import { CreditCard, FileText, LayoutGrid, MoreHorizontal, Plus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Button } from '@/components/controls/button';
import { CustomizeDashboardButton, useDashboardEditing } from '@/components/dashboard/dashboard-layout';
import { InvoiceDialog } from '../transactions/invoice-dialog';
import { PaymentDialog } from '../transactions/payment-dialog';
import { QuoteDialog } from '../transactions/quote-dialog';

type Secondary = 'quote' | 'payment' | 'invoice';

/**
 * The populated Finance Dashboard's header controls, in a stable order: reporting period, Customize
 * dashboard, then actions, the one primary action last. Where the header has room (wide desktop)
 * the secondary actions sit inline; narrower, they move into one More menu so the
 * header never becomes a wall of buttons, while the period, Customize and the primary action stay.
 * A menu closes as its item is chosen, so the dialogs it opens live beside it, not inside it.
 */
export function FinanceHeaderActions({ organizationId, today, period, firstRun = false, mayQuote, mayRecord, mayInvoice, mayCreateWork, mayManageCatalog }: {
  organizationId: string; today: string; period: ReactNode;
  /** Nothing recorded yet: the Dashboard's Getting started panel holds the one next step, so the header offers no primary action to compete with it. */
  firstRun?: boolean;
  mayQuote: boolean; mayRecord: boolean; mayInvoice: boolean; mayCreateWork: boolean; mayManageCatalog: boolean;
}) {
  const [open, setOpen] = useState<Secondary | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const primary: Secondary | null = firstRun ? null : mayInvoice ? 'invoice' : mayRecord ? 'payment' : mayQuote ? 'quote' : null;
  const secondary = ([mayQuote && primary !== 'quote' ? 'quote' : null, mayRecord && primary !== 'payment' ? 'payment' : null, mayInvoice && primary !== 'invoice' ? 'invoice' : null] as const).filter(Boolean) as Secondary[];
  const closed = (next: boolean) => { if (!next) { setOpen(null); requestAnimationFrame(() => more.current?.focus()); } };
  const editing = useDashboardEditing();
  // On a phone, Customize moves into More so the header keeps one row; the menu is therefore always offered there.
  const hasMenu = secondary.length > 0 || Boolean(editing?.available);
  return <>
    {period}
    <CustomizeDashboardButton className="max-sm:hidden" />
    {/* Wide: everything inline. */}
    <span className="hidden min-[1360px]:contents">
      {secondary.includes('quote') ? <QuoteDialog organizationId={organizationId} mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} /> : null}
      {secondary.includes('payment') ? <PaymentDialog organizationId={organizationId} today={today} /> : null}
      {secondary.includes('invoice') ? <InvoiceDialog organizationId={organizationId} today={today} /> : null}
    </span>
    {/* Narrower: one More menu. */}
    {hasMenu ? <span className="contents min-[1360px]:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button ref={more} type="button" tone="secondary" size="small" aria-label="More finance actions"><MoreHorizontal aria-hidden className="size-4" /><span className="max-sm:sr-only">More</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {editing?.available ? <DropdownMenuItem className="sm:hidden" disabled={editing.editing} onSelect={editing.start}><LayoutGrid aria-hidden className="size-4" />Customize dashboard</DropdownMenuItem> : null}
          {secondary.includes('quote') ? <DropdownMenuItem onSelect={() => setOpen('quote')}><Plus aria-hidden className="size-4" />New quote</DropdownMenuItem> : null}
          {secondary.includes('payment') ? <DropdownMenuItem onSelect={() => setOpen('payment')}><CreditCard aria-hidden className="size-4" />Record payment</DropdownMenuItem> : null}
          {secondary.includes('invoice') ? <DropdownMenuItem onSelect={() => setOpen('invoice')}><FileText aria-hidden className="size-4" />New invoice</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {secondary.includes('quote') ? <QuoteDialog organizationId={organizationId} mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} trigger={false} open={open === 'quote'} onOpenChange={closed} /> : null}
      {secondary.includes('payment') ? <PaymentDialog organizationId={organizationId} today={today} trigger={false} open={open === 'payment'} onOpenChange={closed} /> : null}
      {secondary.includes('invoice') ? <InvoiceDialog organizationId={organizationId} today={today} trigger={false} open={open === 'invoice'} onOpenChange={closed} /> : null}
    </span> : null}
    {primary === 'invoice' ? <InvoiceDialog organizationId={organizationId} today={today} tone="primary" />
      : primary === 'payment' ? <PaymentDialog organizationId={organizationId} today={today} tone="primary" />
      : primary === 'quote' ? <QuoteDialog organizationId={organizationId} tone="primary" mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} /> : null}
  </>;
}
