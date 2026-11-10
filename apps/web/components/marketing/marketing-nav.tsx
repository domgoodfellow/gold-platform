'use client';

import Link from 'next/link';
import { ArrowRight, ChevronDown, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gold/ui/components/dropdown-menu';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { Button, ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';
import { OFFERING_GROUPS, offeringHref, offeringsIn } from '@/lib/marketing/content';
import { HEADER_LINKS, PRODUCTS_OVERVIEW } from '@/lib/marketing/navigation';

/**
 * The persistent desktop nav: a Products menu, then the rest.
 *
 * **The menu is grouped by how a business gets a product**, because that is the first thing a
 * visitor has to tell apart: a tool they can use on its own, AI and automation set up with them,
 * or several products working together. Every product is one step away; the overview, which says
 * what each one needs, closes the menu.
 */
export function MarketingNav() {
  return (
    <div className="flex items-center justify-center gap-1 text-sm text-muted">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cx('group flex items-center gap-1 rounded-full px-3 py-1.5 outline-none hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground', FOCUS_RING)}
        >
          Products
          <ChevronDown aria-hidden size={14} className="transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={12}
          collisionPadding={16}
          className="max-h-[min(36rem,var(--radix-dropdown-menu-content-available-height))] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-2"
        >
          <div className="grid gap-2 md:grid-cols-3">
            {OFFERING_GROUPS.map((group) => (
              <DropdownMenuGroup key={group.key} className="flex flex-col">
                <DropdownMenuLabel className="flex flex-col gap-0.5 px-2.5 pt-2.5 pb-1.5">
                  <span className="text-sm font-semibold text-foreground">{group.name}</span>
                  <span className="text-xs font-normal text-subtle">{group.access}</span>
                </DropdownMenuLabel>
                {offeringsIn(group.key).map((offering) => (
                  <DropdownMenuItem key={offering.id} asChild className="rounded-lg">
                    <Link href={offeringHref(offering)} className="flex flex-col items-start gap-0.5 px-2.5 py-2">
                      <span className="font-medium text-foreground">{offering.name}</span>
                      <span className="text-xs leading-snug text-muted">{offering.menuLine}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="rounded-lg">
            <Link href={PRODUCTS_OVERVIEW.href} className="flex items-center justify-between px-2.5 py-2.5 text-sm font-medium">
              See every product and what it needs <ArrowRight aria-hidden size={14} />
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {HEADER_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cx('rounded-full px-3 py-1.5 hover:bg-secondary hover:text-foreground', FOCUS_RING)}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

/** Log in, the primary CTA, and — beneath `sm` — the drawer that carries the whole nav with them. */
export function MarketingActions() {
  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      <Link
        href="/login"
        className={cx('hidden rounded-full px-3 py-1.5 text-sm text-muted hover:bg-secondary hover:text-foreground sm:inline', FOCUS_RING)}
      >
        Log in
      </Link>
      <ButtonLink href="/demo" tone="primary" size="small" className="rounded-full px-4">
        Request a demo
      </ButtonLink>

      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" tone="secondary" size="small" className="rounded-full px-2 sm:hidden" aria-label="Open menu">
            <Menu aria-hidden size={16} />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="flex flex-col gap-6 p-6">
          <SheetHeader className="p-0">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <nav aria-label="Mobile" className="flex flex-1 flex-col gap-5 overflow-y-auto text-base">
            {OFFERING_GROUPS.map((group) => (
              <div key={group.key} className="flex flex-col">
                <p className="mb-1 px-1 text-sm font-semibold">{group.name}</p>
                <ul className="flex flex-col">
                  {offeringsIn(group.key).map((offering) => (
                    <li key={offering.id}>
                      <SheetClose asChild>
                        <Link href={offeringHref(offering)} className={cx('block rounded-lg px-1 py-2 text-muted hover:bg-secondary hover:text-foreground', FOCUS_RING)}>
                          {offering.name}
                        </Link>
                      </SheetClose>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <SheetClose asChild>
              <Link href={PRODUCTS_OVERVIEW.href} className={cx('flex items-center gap-2 rounded-lg px-1 py-2 font-medium hover:bg-secondary', FOCUS_RING)}>
                {PRODUCTS_OVERVIEW.label} <ArrowRight aria-hidden size={16} />
              </Link>
            </SheetClose>
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              {HEADER_LINKS.map((link) => (
                <SheetClose key={link.href} asChild>
                  <Link href={link.href} className={cx('rounded px-1 py-2 hover:bg-secondary', FOCUS_RING)}>{link.label}</Link>
                </SheetClose>
              ))}
            </div>
          </nav>
          <SheetFooter className="p-0">
            <SheetClose asChild>
              <ButtonLink href="/login" tone="secondary" className="w-full">Log in</ButtonLink>
            </SheetClose>
            <SheetClose asChild>
              <ButtonLink href="/demo" tone="primary" className="w-full">Request a demo</ButtonLink>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
