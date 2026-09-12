'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';

const entries = [
  { label: 'Business', href: '#business', root: true },
  { label: 'Public presence', href: '#public-page', root: true },
  { label: 'Website', href: 'website', root: false },
  { label: 'Hours', href: '#hours', root: true },
  { label: 'Modules & features', href: '#modules', root: true },
  { label: 'Work', href: 'work', root: false },
  { label: 'Plan & usage', href: 'plan', root: false },
  { label: 'Connections', href: 'connections', root: false },
] as const;

/** A compact table of contents on phones and a persistent local navigation on larger screens. */
export function SettingsNavigation({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();
  const root = `/organizations/${organizationId}/settings`;
  const activePath = pathname.replace(/\/$/, '');

  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
      <p className="mb-2 hidden px-3 text-xs font-medium uppercase tracking-wide text-subtle lg:block">
        Settings
      </p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {entries.map((entry) => {
          const href = entry.root ? `${root}${entry.href}` : `${root}/${entry.href}`;
          // Hash navigation does not change Next's pathname. Business is the root destination;
          // the other in-page links stay links rather than incorrectly marking every item current.
          const current = entry.root
            ? activePath === root && entry.href === '#business'
            : activePath === href;
          return (
            <li key={entry.label} className="shrink-0">
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  FOCUS_RING,
                  'block rounded px-3 py-2 text-sm',
                  current ? 'bg-foreground font-medium text-background' : 'text-muted hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
