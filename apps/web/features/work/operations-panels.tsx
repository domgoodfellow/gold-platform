import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/display/data';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { formatWindow } from '@/lib/domain/scheduling/window';

export function OperationsPanel({ title, count, action, children, className = '' }: { className?: string; title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className={`min-w-0 overflow-hidden rounded-lg border border-border bg-background ${className}`}>
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2"><h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">{title}{count !== undefined ? <span className="rounded-md bg-surface px-2 py-0.5 text-xs tabular-nums">{count}</span> : null}</h2><div className="text-xs text-accent">{action}</div></div>{children}
  </section>;
}
export function WorkTable({ organizationId, rows, timezone, dispatch = false, dispatchHref, issues = {}, empty = 'No work in this view.' }: {
  organizationId: string; rows: WorkItem[]; timezone: string; dispatch?: boolean; dispatchHref?: string; issues?: Record<string, string>; empty?: string;
}) {
  const base = `/organizations/${organizationId}`;
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs">
    <thead className="border-y border-border bg-surface/60 text-muted"><tr>{['Work', 'Customer', 'Schedule', 'Resources', 'Status', 'Actions'].map(h => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
    <tbody className="divide-y divide-border">{rows.map(w => <tr key={w.id} className="hover:bg-surface/50">
      <td className="min-w-40 px-3 py-2.5"><Link className="font-medium hover:underline" href={`${base}/work/${w.id}`}>{w.title}</Link><div className="mt-0.5 text-[11px] text-muted">{w.type.label}{w.location ? <> · <Link href={`${base}/locations/${w.location.id}`} className="hover:underline">{w.location.label}</Link></> : null}</div></td>
      <td className="px-3 py-2 text-muted">{w.customer ? <Link className="text-accent hover:underline" href={`${base}/customers/${w.customer.id}`}>{w.customer.label}</Link> : 'No customer'}</td>
      <td className="min-w-32 px-3 py-2 tabular-nums text-muted">{w.window ? formatWindow(w.window, timezone) : 'Unscheduled'}</td>
      <td className="min-w-28 px-3 py-2 text-muted">{w.resources.length ? w.resources.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<Link className="hover:underline" href={`${base}/resources/${r.id}`}>{r.label}</Link></span>) : 'Unassigned'}</td>
      <td className="px-3 py-2"><Badge>{w.status.label}</Badge>{issues[w.id] ? <p className="mt-1 text-[11px] text-danger">{issues[w.id]}</p> : null}</td>
      <td className="whitespace-nowrap px-3 py-2"><Link className="text-accent hover:underline" href={dispatch ? `${dispatchHref ?? `${base}/work/dispatch?on=${w.window ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.window.startsAt)) : ''}`}&selected=${w.id}` : `${base}/work/${w.id}`}>{dispatch ? 'Dispatch' : 'Open'}</Link></td>
    </tr>)}{!rows.length ? <tr><td colSpan={6} className="px-3 py-7 text-center text-muted">{empty}</td></tr> : null}</tbody>
  </table></div>;
}
