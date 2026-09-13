'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError } from '@/components/controls/form';
import { payInvoiceAction, type PayInvoiceActionState } from './actions';

const INITIAL: PayInvoiceActionState = { error: null };

/** One invoice, one button. The amount shown is a label only — what is actually charged is
 * derived server-side, again, at the moment this is submitted (I12). */
export function PayInvoiceForm({ invoiceId, amountLabel }: { invoiceId: string; amountLabel: string }) {
  const [state, formAction, pending] = useActionState(payInvoiceAction, INITIAL);
  return (
    <form action={formAction} className="mt-1">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Button type="submit" tone="secondary" disabled={pending}>
        {pending ? 'Starting…' : `Pay ${amountLabel}`}
      </Button>
      <FormError>{state.error}</FormError>
    </form>
  );
}
