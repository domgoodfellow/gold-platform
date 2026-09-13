'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';
import { Hint } from '@/components/controls/inputs';
import { PlatformHeaderTitle } from './platform-header-title';

const sections = [['Overview', ''], ['Plan & Entitlements', '/commercial'], ['Providers', '/providers'], ['Usage', '/usage'], ['Failures', '/failures']] as const;

export function TenantWorkspaceHeader({ id, name, currency }: { id: string; name: string; currency: string }) {
  const pathname = usePathname();
  const base = `/platform/organizations/${id}`;

  return (
    <>
      <PlatformHeaderTitle>{`Organizations / ${name}`}</PlatformHeaderTitle>
      <h2 className="sr-only">{name}</h2>
      <Hint className="block">Tenant ID: {id} · Trades in {currency || 'an unconfigured currency'}.</Hint>
      <nav aria-label="Tenant workspace" className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {sections.map(([label, suffix]) => {
          const href = `${base}${suffix}`;
          const active = pathname === href;
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(FOCUS_RING, 'whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium', active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground')}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
