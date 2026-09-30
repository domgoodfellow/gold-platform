import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/surfaces/card';
import { cx, FOCUS_RING } from '@/components/class-names';

export type Kpi = { key: string; label: string; value: ReactNode; note?: ReactNode; href: string };

/** One compact figure. The whole card is the link — it holds no rows of its own to keep clickable. */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <Card as="section" className="p-0">
      <Link href={kpi.href} className={cx('flex h-full flex-col gap-1 rounded-xl p-4 hover:bg-hover', FOCUS_RING)}>
        <span className="text-sm text-muted">{kpi.label}</span>
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{kpi.value}</span>
        {kpi.note ? <span className="text-xs text-muted">{kpi.note}</span> : null}
      </Link>
    </Card>
  );
}
