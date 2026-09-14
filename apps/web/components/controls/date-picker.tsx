'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarIcon } from 'lucide-react';
import { Button as ShadcnButton } from '@gold/ui/components/button';
import { Calendar } from '@gold/ui/components/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { FOCUS_RING, cx } from '@/components/class-names';

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * A day, picked rather than typed or scrolled to — the shared calendar/popover primitives
 * (`packages/ui`), composed once. Navigates on pick rather than needing a separate submit, so a
 * page whose day lives in the URL (`?on=`) stays a plain server-rendered read on every choice.
 */
export function DatePicker({
  value,
  href,
  label = 'Choose a day',
}: {
  /** ISO `yyyy-mm-dd`, read in the caller's own timezone — this control only ever displays it. */
  value: string;
  /** Where picking a day navigates. */
  href: (isoValue: string) => string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const selected = new Date(`${value}T00:00:00`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ShadcnButton
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          className={cx(FOCUS_RING, 'gap-1.5')}
        >
          <CalendarIcon aria-hidden size={14} />
          {selected.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </ShadcnButton>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(next) => {
            if (!next) return;
            setOpen(false);
            router.push(href(isoDate(next)));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
