'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CircleDollarSign, Gauge, Landmark, Package, Plug, TriangleAlert } from 'lucide-react';
import { cx, FOCUS_RING } from '@/components/class-names';

export const PLATFORM_NAV = [
  { label: 'Organizations', href: '/platform/organizations', icon: Building2, group: 'Customers' },
  { label: 'Products', href: '/platform/catalog/products', icon: Package, group: 'Catalog' },
  { label: 'Modules', href: '/platform/catalog/modules', icon: Landmark, group: 'Catalog' },
  { label: 'Meters', href: '/platform/catalog/meters', icon: Gauge, group: 'Catalog' },
  { label: 'Pricing', href: '/platform/pricing', icon: CircleDollarSign, group: 'Commercial' },
  { label: 'Providers', href: '/platform/providers', icon: Plug, group: 'Infrastructure' },
  { label: 'Failures', href: '/platform/failures', icon: TriangleAlert, group: 'Infrastructure' },
] as const;

export function PlatformNavigation() { const pathname = usePathname(); let group = ''; return <nav aria-label="Platform" className="flex-1 overflow-y-auto p-3">{PLATFORM_NAV.map((item) => { const Icon=item.icon; const active=pathname===item.href || (item.href==='/platform/organizations' && pathname.startsWith('/platform/organizations')); const label=item.group !== group ? (group=item.group, <p className="mt-4 px-3 text-xs uppercase tracking-wide text-subtle">{group}</p>) : null; return <div key={item.href}>{label}<Link href={item.href} aria-current={active?'page':undefined} className={cx(FOCUS_RING,'mt-1 flex items-center gap-3 rounded px-3 py-2 text-sm',active?'bg-foreground font-medium text-background':'hover:bg-black/5 dark:hover:bg-white/10')}><Icon aria-hidden size={17}/><span>{item.label}</span></Link></div>; })}</nav>; }
