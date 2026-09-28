'use client';

import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gold/ui/components/breadcrumb';
import { cx, FOCUS_RING } from '../class-names';

export type Crumb = { label: ReactNode; href?: string };

type SlotContext = { slot: HTMLElement | null; setSlot: (element: HTMLElement | null) => void };

const CrumbSlotContext = createContext<SlotContext | null>(null);

/** Hosts the slot the workspace bar exposes; the page still owns what is written into it. */
export function WorkspaceCrumbsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return <CrumbSlotContext.Provider value={{ slot, setSlot }}>{children}</CrumbSlotContext.Provider>;
}

/** The place in the workspace bar where the current page's trail appears. */
export function WorkspaceCrumbSlot() {
  const context = useContext(CrumbSlotContext);
  return <div ref={context?.setSlot} className="min-w-0 flex-1 sm:flex-none" />;
}

/**
 * A page's full trail, rendered into the workspace bar: `ancestors + current`. Always renders —
 * there is no page with nothing to say here, since `current` is required and every `PageHeader`
 * supplies one. The current page is the final, non-linked segment (`BreadcrumbPage`); an ancestor
 * is a link only where it names a real destination, and plain text otherwise (a heading with no
 * page of its own, such as a Platform sidebar group). The current segment carries the flexible,
 * truncating space first, so a long record title yields before an ancestor does and never pushes
 * the header's other controls out of view.
 */
export function PageCrumbs({ crumbs, current }: { crumbs: Crumb[]; current: ReactNode }) {
  const slot = useContext(CrumbSlotContext)?.slot;
  if (!slot) return null;
  return createPortal(
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <Fragment key={index}>
            <BreadcrumbItem className="min-w-0 shrink">
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className={cx('block truncate rounded underline-offset-4 hover:text-foreground hover:underline', FOCUS_RING)}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="block truncate">{crumb.label}</span>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem className="min-w-0 flex-1">
          <BreadcrumbPage className="block truncate">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>,
    slot,
  );
}
