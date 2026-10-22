import Link from 'next/link';
import type { ReactNode } from 'react';
import { tabListStyles, tabTriggerStyles, type TabVariant } from '@gold/ui/components/tab-styles';
import { cn } from 'cn';
import { ButtonLink } from '../controls/button';

export type ViewNavItem = { key: string; label: ReactNode; href: string; current?: boolean };
type ViewNavProps = {
  label: string;
  current?: string;
  variant?: TabVariant;
  scroll?: boolean;
  className?: string;
  size?: 'small';
} & ({ views: readonly ViewNavItem[]; items?: never } | { items: readonly ViewNavItem[]; views?: never });

/** URL-backed sibling views. Wrapping keeps every destination, including the current one, visible. */
export function ViewNav({ label, views, items, current, variant = 'segmented', scroll, className, size }: ViewNavProps) {
  return <nav aria-label={label} data-slot="tabs-list" data-variant={variant} className={cn(tabListStyles(variant), 'mb-4', className)}>
    {(views ?? items).map(item => size ? <ButtonLink key={item.key} href={item.href} scroll={scroll} size={size} tone="ghost"
      className="aria-[current=page]:bg-selected aria-[current=page]:font-semibold"
      aria-current={(current === undefined ? item.current : item.key === current) ? 'page' : undefined}>{item.label}</ButtonLink> : <Link key={item.key} href={item.href} scroll={scroll}
      data-slot="tabs-trigger" aria-current={(current === undefined ? item.current : item.key === current) ? 'page' : undefined}
      className={tabTriggerStyles}>{item.label}</Link>)}
  </nav>;
}
