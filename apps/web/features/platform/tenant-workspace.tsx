'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';

const sections = [['Overview', ''], ['Commercial', '/commercial'], ['Providers', '/providers'], ['Usage', '/usage'], ['Failures', '/failures']] as const;

export function TenantWorkspaceHeader({ id, name, currency }: { id: string; name: string; currency: string }) {
  const pathname = usePathname();
  const base = `/platform/organizations/${id}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/platform/organizations" className="hover:underline">Organizations</Link>
        <span aria-hidden> / </span>{name}
      </nav>
      <PageHeading className="mt-3">{name}</PageHeading>
      <Hint className="mt-1 block">Tenant ID: {id} · Trades in {currency || 'an unconfigured currency'}.</Hint>
      <nav aria-label="Tenant workspace" className="mt-5 flex gap-1 overflow-x-auto border-b border-border">
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
