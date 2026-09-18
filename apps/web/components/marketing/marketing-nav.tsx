'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@gold/ui/components/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { Button, ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';
import { PRODUCTS } from '@/lib/marketing/content';

const SECONDARY_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/pricing', label: 'Pricing' },
];

/** The persistent desktop nav: a Products menu naming the three commercial doors, then the rest. */
export function MarketingNav() {
  return (
    <div className="flex items-center gap-6 text-sm text-muted">
      <DropdownMenu>
        <DropdownMenuTrigger className={cx('rounded outline-none hover:text-foreground', FOCUS_RING)}>
          Products
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          {PRODUCTS.map((product) => (
            <DropdownMenuItem key={product.slug} asChild>
              <Link href={product.href} className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-medium text-foreground">{product.name}</span>
                <span className="text-xs text-muted">{product.summary}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {SECONDARY_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={cx('rounded hover:text-foreground', FOCUS_RING)}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

/** Log in, the primary CTA, and — beneath `sm` — the drawer that carries the whole nav with them. */
export function MarketingActions() {
  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-4">
      <Link
        href="/login"
        className={cx('hidden rounded text-sm text-muted hover:text-foreground sm:inline', FOCUS_RING)}
      >
        Log in
      </Link>
      <ButtonLink href="/demo" tone="primary" size="small">
        Request a demo
      </ButtonLink>

      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" tone="secondary" size="small" className="px-2 sm:hidden" aria-label="Open menu">
            <Menu aria-hidden size={16} />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="flex flex-col gap-6 p-6">
          <SheetHeader className="p-0">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 text-base">
            <p className="mt-2 mb-1 font-mono text-xs uppercase tracking-[0.18em] text-subtle">Products</p>
            {PRODUCTS.map((product) => (
              <Link key={product.slug} href={product.href} className={cx('rounded px-1 py-2 hover:text-muted', FOCUS_RING)}>
                {product.name}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
              {SECONDARY_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={cx('rounded px-1 py-2 hover:text-muted', FOCUS_RING)}>
                  {link.label}
                </Link>
              ))}
              <Link href="/login" className={cx('rounded px-1 py-2 hover:text-muted', FOCUS_RING)}>
                Log in
              </Link>
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
