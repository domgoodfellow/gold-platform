'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { Button } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { ShellSection } from '@/lib/shell';

/**
 * The phone bar's overflow: every destination the bar does not carry, grouped exactly as the
 * desktop sidebar groups them. A modal sheet is right here — it is navigation, opened by an
 * explicit tap and dismissed by choosing somewhere — and is not a page drawer (`PageDrawer` is the
 * non-modal surface for a page's own work). It renders the sections it is handed and decides
 * nothing: which items exist is `projectShell`'s answer.
 */
export function MoreMenu({
  sections,
  activeKey,
  triggerClassName,
  renderIcon,
}: {
  sections: ShellSection[];
  activeKey: string | null;
  /** The bar's own row styling, so More reads as one of its destinations. */
  triggerClassName: string;
  renderIcon: (key: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = sections.some((section) => section.items.some((item) => item.key === activeKey));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          aria-label="More"
          aria-current={current ? 'page' : undefined}
          className={cx(
            triggerClassName,
            'h-auto border-0 shadow-none',
            current ? 'bg-foreground font-medium text-background hover:bg-foreground' : 'bg-transparent hover:bg-hover',
          )}
        >
          <MoreHorizontal aria-hidden size={18} className="shrink-0" />
          <span className="min-w-0">More</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-6">
        <SheetHeader>
          <SheetTitle>More</SheetTitle>
          <SheetDescription className="sr-only">Every other place you can go in this business.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          {sections.map((section) => (
            <section key={section.key} aria-label={section.label ?? 'Workspaces'}>
              {section.label ? (
                <h3 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-subtle">{section.label}</h3>
              ) : null}
              <ul className="flex flex-col">
                {section.items.map((item) => {
                  const isCurrent = item.key === activeKey;
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        aria-current={isCurrent ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cx(
                          FOCUS_RING,
                          'flex items-center gap-3 rounded px-2 py-2.5 text-sm',
                          isCurrent ? 'bg-foreground font-medium text-background' : 'hover:bg-hover',
                        )}
                      >
                        {renderIcon(item.key)}
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
