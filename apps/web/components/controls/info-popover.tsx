'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { Button } from './button';
import { cx } from '../class-names';

/**
 * Supplemental explanation a person chooses to open (docs/ui-system.md → Core rules, disclosure
 * patterns): what a figure counts, how a state is defined, where evidence comes from. Never an
 * instruction required before acting, and never on every row.
 *
 * It opens on click, tap and keyboard (Enter or Space on its button). The trigger is named by
 * `label` and exposes its expanded state; Escape closes it and returns focus to the trigger. The
 * trigger is 44px square on a phone and compact from the small breakpoint up. The content portals
 * into the nearest VisualScope through the shared popover, so theme, preset and density apply.
 */
export function InfoPopover({
  label,
  children,
  align = 'start',
  className,
}: {
  /** The trigger's accessible name, saying what it explains: "About resolution performance". */
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          tone="ghost"
          aria-label={label}
          className={cx('size-11 shrink-0 rounded-full p-0 text-muted hover:text-foreground sm:size-7', className)}
        >
          <Info aria-hidden className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="text-sm leading-6">
        {children}
      </PopoverContent>
    </Popover>
  );
}
