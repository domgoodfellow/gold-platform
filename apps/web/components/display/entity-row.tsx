import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx, FOCUS_RING } from '../class-names';

/**
 * Who a row is about: an identity icon (with its meaning spoken, not only drawn), the primary label
 * as the one link that opens the record, and a quieter secondary line (affiliation, type). Domain
 * data stays with the caller; this only arranges it.
 */
export function EntityIdentity({ icon: Icon, kind, name, href, secondary, className }: {
  icon: LucideIcon; kind: string; name: ReactNode; href?: string; secondary?: ReactNode; className?: string;
}) {
  return <span className={cx('flex min-w-0 items-start gap-2.5', className)}>
    <span data-slot="entity-icon" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted">
      <Icon aria-hidden className="size-3.5" /><span className="sr-only">{kind}</span>
    </span>
    <span className="min-w-0">
      {href ? <Link href={href} className={cx('block truncate font-medium text-foreground hover:underline', FOCUS_RING)}>{name}</Link> : <span className="block truncate font-medium">{name}</span>}
      {secondary ? <span className="block truncate text-xs text-muted">{secondary}</span> : null}
    </span>
  </span>;
}

/**
 * One record in a list: identity first, then status chips, a short activity summary, a timestamp
 * and row actions. It reflows from one line on wide containers to a stacked card on narrow ones,
 * keeping the identity first in reading order at every width.
 */
export function EntityRow({ identity, status, activity, timestamp, actions, className, as: Element = 'li' }: {
  identity: ReactNode; status?: ReactNode; activity?: ReactNode; timestamp?: ReactNode; actions?: ReactNode; className?: string; as?: 'li' | 'div';
}) {
  return <Element data-slot="entity-row" className={cx('@container grid gap-x-4 gap-y-1.5 px-4 py-3 text-sm @lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_auto] @lg:items-center', className)}>
    <span className="flex min-w-0 flex-col gap-1.5">{identity}{status ? <span className="flex flex-wrap gap-1 pl-9.5">{status}</span> : null}</span>
    <span className="min-w-0 pl-9.5 text-xs @lg:pl-0">{activity}</span>
    <span className="flex items-center gap-3 pl-9.5 text-xs text-muted @lg:justify-end @lg:pl-0">{timestamp}{actions}</span>
  </Element>;
}
