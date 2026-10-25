'use client';

import { useState } from 'react';
import Link from 'next/link';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { ButtonLink } from '@/components/controls/button';

export type AttentionRow = { id: string; href: string; title: string; detail: string; amount: string; tone?: 'danger' };
export type AttentionCategory = { key: string; label: string; count: number; href: string; rows: AttentionRow[] };

/**
 * Finance's actionable exceptions, one category at a time. Only categories with records are offered
 * (the Dashboard shows one all-clear line instead of this when none are), and no record appears in
 * two: overdue and due-soon invoices are disjoint by time, and priced Work is not yet an invoice.
 */
export function FinanceAttention({ categories }: { categories: AttentionCategory[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const tab = categories.find(category => category.key === chosen) ?? categories[0];
  if (!tab) return null;
  return <>
    {categories.length > 1 ? <div data-slot="tabs-list" data-variant="segmented" role="group" aria-label="Attention categories" className={tabListStyles()}>
      {categories.map(category => <button key={category.key} type="button" aria-pressed={tab.key === category.key} onClick={() => setChosen(category.key)} data-slot="tabs-trigger" className={tabTriggerStyles}>{category.label} <span className="ml-1 tabular-nums">{category.count}</span></button>)}
    </div> : <p className="text-sm font-medium">{tab.label} <span className="tabular-nums text-muted">{tab.count}</span></p>}
    <ul aria-label={tab.label} className="mt-1 divide-y divide-border text-sm">
      {tab.rows.map(row => <li key={row.id}><Link href={row.href} className="flex items-baseline justify-between gap-3 py-2.5 hover:bg-hover">
        <span className="min-w-0"><span className="block break-words font-medium">{row.title}</span><span className="block text-xs text-muted">{row.detail}</span></span>
        <span className={`shrink-0 tabular-nums ${row.tone === 'danger' ? 'font-semibold text-danger' : 'font-medium'}`}>{row.amount}</span>
      </Link></li>)}
    </ul>
    <div className="mt-2 text-right"><ButtonLink tone="text" size="small" href={tab.href}>{tab.count > tab.rows.length ? `View all ${tab.count}` : 'View all'}</ButtonLink></div>
  </>;
}
