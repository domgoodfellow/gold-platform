'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SelectField } from './select-field';

/**
 * A dashboard's reporting period when it is the only thing being chosen: a styled Select whose
 * choices are addresses. Choosing one goes there at once — there is no Apply — and each address is
 * built by the page's own query builder, so the dashboard's other filters (queue, channel, search…)
 * travel with it and the address stays the one view model. Multi-field filter forms keep their
 * Apply; this is not for them.
 */
export function PeriodSelect({ label, value, options, size = 'small', className }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; href: string }[];
  size?: 'default' | 'small';
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Shows the choice at once while the dashboard loads; the address then confirms it.
  const [shown, setShown] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setShown(value);
  }
  return (
    <SelectField
      aria-label={label}
      size={size}
      className={className}
      value={shown}
      searchable={false}
      aria-busy={pending || undefined}
      options={options.map(({ value: key, label: text }) => ({ value: key, label: text }))}
      onValueChange={next => {
        const href = options.find(option => option.value === next)?.href;
        if (!href) return;
        setShown(next);
        start(() => router.push(href, { scroll: false }));
      }}
    />
  );
}
