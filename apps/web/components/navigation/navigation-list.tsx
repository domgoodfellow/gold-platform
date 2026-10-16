import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx, FOCUS_RING } from '../class-names';

export type NavigationListItem = {
  key: string;
  href: string;
  title: ReactNode;
  description?: ReactNode;
  metadata?: ReactNode;
  icon?: ReactNode;
  current?: boolean;
  chevron?: boolean;
};

/** Destination choices; record lists and tables retain their own separation and actions. */
export function NavigationList({ label, items, current, density = 'standard', className }: {
  label: string;
  items: readonly NavigationListItem[];
  current?: string;
  density?: 'compact' | 'standard';
  className?: string;
}) {
  return <nav aria-label={label} data-slot="navigation-list" data-density={density}>
    <ul className={cx('grid gap-1', className)}>{items.map(item => <li key={item.key} className="min-w-0">
      <Link href={item.href} aria-current={(current === undefined ? item.current : item.key === current) ? 'page' : undefined}
        className={cx(FOCUS_RING, 'flex min-h-11 h-full items-center gap-3 rounded-[var(--visual-radius,0.625rem)] text-sm text-foreground hover:bg-hover aria-[current=page]:bg-selected aria-[current=page]:font-semibold', density === 'compact' ? 'px-3 py-2' : 'px-4 py-3')}>
        {item.icon ? <span aria-hidden className="shrink-0 text-muted [&_svg]:size-4">{item.icon}</span> : null}
        <span className="min-w-0 flex-1 break-words"><span className="block font-medium">{item.title}</span>
          {item.description ? <span className="mt-0.5 block text-sm text-muted">{item.description}</span> : null}
          {item.metadata ? <span className="mt-0.5 block text-xs text-muted">{item.metadata}</span> : null}
        </span>
        {item.chevron ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" /> : null}
      </Link>
    </li>)}</ul>
  </nav>;
}
