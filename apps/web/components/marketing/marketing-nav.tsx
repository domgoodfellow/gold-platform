'use client';

import Link from 'next/link';
import { ArrowRight, ChevronDown, Headset, Menu, TrendingUp, Workflow, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { PRODUCTS, type ProductSlug } from '@/lib/marketing/content';
import { HEADER_LINKS } from '@/lib/marketing/navigation';

const PRODUCT_ICON: Record<ProductSlug, LucideIcon> = {
  sales: TrendingUp,
  operations: Workflow,
  'customer-service': Headset,
};

/** The persistent desktop nav: a Products menu naming the three commercial doors, then the rest. */
export function MarketingNav() {
  return (
    <div className="flex items-center justify-center gap-1 text-sm text-muted">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cx('group flex items-center gap-1 rounded-full px-3 py-1.5 outline-none hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground', FOCUS_RING)}
        >
          Products
          <ChevronDown aria-hidden size={14} className="transition-transform group-data-[state=open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={12} className="w-80 rounded-xl p-2">
          {PRODUCTS.map((product) => {
            const Icon = PRODUCT_ICON[product.slug];
            return (
              <DropdownMenuItem key={product.slug} asChild className="rounded-lg">
                <Link href={product.href} className="flex items-start gap-3 p-2.5">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                    <Icon aria-hidden size={16} />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{product.name}</span>
                    <span className="text-xs leading-snug text-muted">{product.summary}</span>
                  </span>
                </Link>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="rounded-lg">
            <Link href="/how-it-works" className="flex items-center justify-between p-2.5 text-xs font-medium">
              See how the three fit together <ArrowRight aria-hidden size={14} />
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
          <nav aria-label="Mobile" className="flex flex-1 flex-col gap-1 overflow-y-auto text-base">
            <p className="mt-2 mb-1 font-mono text-xs uppercase tracking-[0.18em] text-subtle">Products</p>
            {PRODUCTS.map((product) => {
              const Icon = PRODUCT_ICON[product.slug];
              return (
                <SheetClose key={product.slug} asChild>
                  <Link href={product.href} className={cx('flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-secondary', FOCUS_RING)}>
                    <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background"><Icon aria-hidden size={16} /></span>
                    {product.name}
                  </Link>
                </SheetClose>
              );
            })}
            <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
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
