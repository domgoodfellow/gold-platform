import type { ComponentProps } from 'react';
import { Button } from '@gold/ui/components/button';
import { cx } from '@/components/class-names';

/** A toggle choice. Exclusive selection policy remains with the caller. No nested controls. */
export function SelectableCard({ selected, className, ...props }: ComponentProps<'button'> & { selected: boolean }) {
  return <Button {...props} type={props.type ?? 'button'} variant="outline" aria-pressed={selected}
    data-slot="selectable-card" className={cx('h-auto min-h-20 w-full flex-col items-start whitespace-normal p-4 text-left aria-pressed:border-foreground aria-pressed:bg-selected', className)} />;
}
