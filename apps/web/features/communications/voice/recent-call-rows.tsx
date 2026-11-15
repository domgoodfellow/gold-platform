import Link from 'next/link';
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { StatePill } from '@/components/operational/primitives';
import { FOCUS_RING, cx } from '@/components/class-names';
import type { RecentCallRow } from './format';

/** A contact's most recent recorded calls, newest first, each linked to its call record. */
export function RecentCallRows({ organizationId, rows }: { organizationId: string; rows: readonly RecentCallRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No recorded calls with this contact yet.</p>;
  return (
    <ol className="space-y-1">
      {rows.map((row) => {
        const Icon = row.inbound ? PhoneIncoming : PhoneOutgoing;
        return (
          <li key={row.id}>
            <Link href={`/organizations/${organizationId}/calls/${row.id}`} className={cx('-mx-2 flex items-start gap-3 rounded-md px-2 py-2 hover:bg-hover', FOCUS_RING)}>
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted"><Icon aria-hidden className="size-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{row.inbound ? 'Inbound call' : 'Outbound call'}</span>
                  <StatePill tone={row.tone}>{row.status}</StatePill>
                </span>
                <span className="block text-xs text-muted tabular-nums">{row.detail}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
