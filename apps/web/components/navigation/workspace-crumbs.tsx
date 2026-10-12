'use client';

import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@gold/ui/components/dropdown-menu';
import { Button, ButtonLink } from '../controls/button';
import { pageNavigation, type LocationNavigation, type PageNavigation } from '@/lib/shell';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gold/ui/components/breadcrumb';
import { cx, FOCUS_RING } from '../class-names';

export type Crumb = { label: ReactNode; href?: string };

type SlotContext = { slot: HTMLElement | null; setSlot: (element: HTMLElement | null) => void; navigation?: LocationNavigation };

const CrumbSlotContext = createContext<SlotContext | null>(null);

/** Hosts the slot the workspace bar exposes; the page still owns what is written into it. */
export function WorkspaceCrumbsProvider({ children, navigation }: { children: ReactNode; navigation?: LocationNavigation }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return <CrumbSlotContext.Provider value={{ slot, setSlot, navigation }}>{children}</CrumbSlotContext.Provider>;
}

/** The place in the workspace bar where the current page's trail appears. */
export function WorkspaceCrumbSlot() {
  const context = useContext(CrumbSlotContext);
  return <div ref={context?.setSlot} className="min-w-0 flex-1 md:flex-none" />;
}

function MobilePageLocation({ current, navigation }: { current: ReactNode; navigation: PageNavigation }) {
  const [open, setOpen] = useState(false);
  const interactive = navigation.groups.reduce((count, group) => count + group.items.length, 0) > 1;
  return <nav aria-label="Page location" className="flex min-w-0 items-center gap-1 md:hidden">
    {navigation.parentHref ? <ButtonLink href={navigation.parentHref} tone="ghost" aria-label="Back to parent" className="size-10 shrink-0 p-0"><ArrowLeft aria-hidden size={18} /></ButtonLink> : null}
    {interactive ? <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button tone="ghost" className="h-10 min-w-0 shrink justify-start gap-1 px-2" aria-label="Navigate within current section">
          <span aria-current="page" className="truncate">{current}</span><ChevronDown aria-hidden size={16} className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(70dvh,28rem)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
        {navigation.groups.map((group, index) => <Fragment key={index}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href} aria-current={item.key === navigation.activeKey ? 'page' : undefined} className={cx('min-h-10 min-w-0', item.key === navigation.activeKey && 'bg-selected text-foreground font-medium')}>
              <span className="min-w-0 flex-1 whitespace-normal break-words">{item.label}</span>
              {item.key === navigation.activeKey ? <Check aria-hidden size={16} /> : null}
            </Link>
          </DropdownMenuItem>)}
        </Fragment>)}
      </DropdownMenuContent>
    </DropdownMenu> : <span aria-current="page" className="min-w-0 truncate px-2 text-sm">{current}</span>}
  </nav>;
}

/** Desktop and mobile share the page's published current label and ancestors. */
export function PageCrumbs({ crumbs, current }: { crumbs: Crumb[]; current: ReactNode }) {
  const context = useContext(CrumbSlotContext);
  const slot = context?.slot;
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const navigation = pageNavigation(context?.navigation, pathname, crumbs.map((crumb) => crumb.href));
  if (!slot) return null;
  return createPortal(
    <>
    <MobilePageLocation key={`${pathname}:${isMobile}`} current={current} navigation={navigation} />
    <Breadcrumb className="hidden md:block">
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
    </Breadcrumb>
    </>,
    slot,
  );
}
