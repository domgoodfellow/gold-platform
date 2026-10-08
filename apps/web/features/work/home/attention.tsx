'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { WorkTable } from '../operations-panels';
export type AttentionGroup = { key: string; label: string; count: number; rows: WorkItem[]; href: string; issues?: Record<string, string> };
export function WorkAttention({ organizationId, timezone, groups }: { organizationId: string; timezone: string; groups: AttentionGroup[] }) {
  const [key, setKey] = useState(groups[0].key);
  const selected = groups.find(g => g.key === key) ?? groups[0];
  return <><div className="flex items-center gap-2 px-3"><div className="flex min-w-0 flex-1 gap-4 overflow-x-auto" role="tablist" aria-label="Attention categories">{groups.map(g => <button key={g.key} type="button" id={`attention-tab-${g.key}`} aria-controls={`attention-${g.key}`} role="tab" aria-selected={g.key === key} onClick={() => setKey(g.key)} className={`shrink-0 border-b-2 py-2 text-xs ${g.key === key ? 'border-accent font-semibold text-foreground' : 'border-transparent text-muted'}`}>{g.label} ({g.count})</button>)}</div><Link href={selected.href} className="shrink-0 text-xs text-accent hover:underline">View all</Link></div>
    <div role="tabpanel" id={`attention-${selected.key}`} aria-labelledby={`attention-tab-${selected.key}`}><WorkTable organizationId={organizationId} timezone={timezone} rows={selected.rows} dispatch dispatchHref={selected.href} issues={selected.issues} empty="Nothing needs attention in this category."/></div></>;
}
