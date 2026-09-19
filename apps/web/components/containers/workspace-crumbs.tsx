'use client';

import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
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

/** A page's trail, rendered into the workspace bar. Ancestors only; the title is the page's own `<h1>`. */
export function PageCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const slot = useContext(CrumbSlotContext)?.slot;
  if (!slot || crumbs.length === 0) return null;
  return createPortal(
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <Fragment key={index}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem className="min-w-0">
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className={cx('truncate rounded underline-offset-4 hover:text-foreground hover:underline', FOCUS_RING)}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>,
    slot,
  );
}
