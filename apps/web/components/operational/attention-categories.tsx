'use client';

import { useState } from 'react';
import Link from 'next/link';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { ButtonLink } from '../controls/button';

/** One record needing attention: what it is, a short fact about it, and the value that makes it urgent (an amount, a gap). */
export type AttentionRow = { id: string; href: string; title: string; detail: string; value: string; tone?: 'danger' };
export type AttentionCategory = { key: string; label: string; count: number; href: string; rows: AttentionRow[] };

/**
 * A Dashboard's actionable exceptions, one category at a time. The caller offers only categories
 * with records (and shows one all-clear line instead of this when none are), keeps each record in
 * one category, and gives each category its filtered destination. Finance and Work both use it.
 */
export function AttentionCategories({ categories }: { categories: AttentionCategory[] }) {
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
        <span className={`shrink-0 text-right tabular-nums ${row.tone === 'danger' ? 'font-semibold text-danger' : 'font-medium'}`}>{row.value}</span>
      </Link></li>)}
    </ul>
    <div className="mt-2 text-right"><ButtonLink tone="text" size="small" href={tab.href}>{tab.count > tab.rows.length ? `View all ${tab.count}` : 'View all'}</ButtonLink></div>
  </>;
}
