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
 *
 * `basePath` rather than an `href` callback: this is a Client Component, and a function defined
 * in the server-rendered caller cannot cross that boundary as a prop — only serializable values
 * can. Appending the query string here is the one thing that would otherwise need one.
 */
export function DatePicker({
  value,
  basePath,
  param = 'on',
  label = 'Choose a day',
  extraParams,
}: {
  /** ISO `yyyy-mm-dd`, read in the caller's own timezone — this control only ever displays it. */
  value: string;
  /** Where picking a day navigates, without the query string. */
  basePath: string;
  /** The query parameter the picked day is written to. */
  param?: string;
  label?: string;
  /**
   * Other query state to carry over when a day is picked — a view, a set of filter ids. Written
   * through exactly as given, one entry per array value: this control never learns what a key
   * means, only that it is serializable.
   */
  extraParams?: Record<string, string | readonly string[]>;
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
          {/* A fixed locale, not the runtime's own — the server and the browser rarely agree on
              one, and an implicit locale here is a hydration mismatch waiting to happen. */}
          {selected.toLocaleDateString('en-GB', {
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
            const params = new URLSearchParams();
            for (const [key, entry] of Object.entries(extraParams ?? {})) {
              for (const value of Array.isArray(entry) ? entry : [entry]) params.append(key, value as string);
            }
            params.set(param, isoDate(next));
            router.push(`${basePath}?${params.toString()}`);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
