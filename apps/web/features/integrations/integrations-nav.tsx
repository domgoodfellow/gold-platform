import Link from 'next/link';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * The Integrations area's own sections. Connected and Browse are views of one page; Data sources
 * and Imports are their own routes, so this is plain links rather than client tabs.
 */
export function IntegrationsNav({ organizationId, current }: { organizationId: string; current: 'connected' | 'browse' }) {
  const base = `/organizations/${organizationId}/integrations`;
  const items = [
    { key: 'connected', label: 'Connected', href: base },
    { key: 'browse', label: 'Browse apps', href: `${base}?view=browse` },
    { key: 'sources', label: 'Data sources', href: `${base}/sources` },
    { key: 'imports', label: 'Imports', href: `${base}/imports` },
  ] as const;

  return (
    <nav aria-label="Integrations" className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm',
            FOCUS_RING,
            item.key === current ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
