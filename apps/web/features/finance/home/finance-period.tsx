'use client';

import { useRef } from 'react';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';

/**
 * The reporting month: a plain GET form, so the address stays the one view model. Choosing a month
 * applies it straight away; Apply stays visible where there is room, and on a phone the field alone
 * is enough, which keeps the header to one row.
 */
export function FinancePeriod({ action, month }: { action: string; month: string }) {
  const form = useRef<HTMLFormElement>(null);
  return <form ref={form} method="get" action={action} className="flex items-center gap-1">
    <TextInput aria-label="Reporting month" name="month" type="month" defaultValue={month} size="small" className="w-36"
      onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.value !== month) form.current?.requestSubmit(); }} />
    <Button type="submit" tone="text" size="small" className="max-sm:hidden">Apply</Button>
  </form>;
}
