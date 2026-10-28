'use client';

import { useRef } from 'react';
import { Button } from './button';
import { TextInput } from './inputs';

const COMPLETE = { date: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/ } as const;

/**
 * A Dashboard's one period control — a day or a reporting month — as a plain GET form, so the
 * address stays the one view model. Choosing a complete value applies it straight away; Apply stays
 * visible where there is room (and without script), and on a phone the field alone is enough, which
 * keeps the header to one row.
 */
export function PeriodField({ action, name, type, label, value }: { action: string; name: string; type: 'date' | 'month'; label: string; value: string }) {
  const form = useRef<HTMLFormElement>(null);
  return <form ref={form} method="get" action={action} className="flex items-center gap-1">
    <TextInput aria-label={label} name={name} type={type} defaultValue={value} size="small" className={type === 'date' ? 'w-36 sm:w-40' : 'w-36'}
      onChange={event => { if (COMPLETE[type].test(event.target.value) && event.target.value !== value) form.current?.requestSubmit(); }} />
    <Button type="submit" tone="text" size="small" className="max-sm:hidden">Apply</Button>
  </form>;
}
