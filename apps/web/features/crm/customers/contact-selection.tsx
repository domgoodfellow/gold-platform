'use client';

import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { Button } from '@/components/controls/button';
import { AddToListMenu } from '@/features/communications/voice/add-to-list-menu';

type Selection = { selected: ReadonlySet<string>; set: (ids: readonly string[], on: boolean) => void; clear: () => void };
const SelectionContext = createContext<Selection | null>(null);

/**
 * Which contacts on the shown page are ticked, for Add to. A selection belongs to the rows on
 * screen: when the page, search or filters change, ticks for rows no longer shown are dropped, so
 * an action never reaches someone the person cannot see.
 */
export function ContactSelection({ pageIds, children }: { pageIds: readonly string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const pageKey = pageIds.join(',');
  const [shownKey, setShownKey] = useState(pageKey);
  // Adjusted while rendering (not in an effect) when the shown rows change, so no stale tick is ever drawn.
  if (shownKey !== pageKey) {
    setShownKey(pageKey);
    const shown = new Set(pageIds);
    setSelected(new Set([...selected].filter(id => shown.has(id))));
  }
  const set = useCallback((ids: readonly string[], on: boolean) => setSelected(current => {
    const next = new Set(current);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  }), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const value = useMemo(() => ({ selected, set, clear }), [selected, set, clear]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error('Contact selection controls must sit inside ContactSelection.');
  return selection;
}

export function SelectContact({ id, name }: { id: string; name: string }) {
  const { selected, set } = useSelection();
  return <Checkbox aria-label={`Select ${name}`} checked={selected.has(id)} onCheckedChange={value => set([id], value === true)} />;
}

/** Ticks or clears every row of one table (the page, or one company group). `labelled` adds visible text, for cards. */
export function SelectAllContacts({ ids, labelled = false }: { ids: readonly string[]; labelled?: boolean }) {
  const { selected, set } = useSelection();
  const id = useId();
  const count = ids.filter(contact => selected.has(contact)).length;
  const state = count === 0 ? false : count === ids.length ? true : 'indeterminate';
  const box = <Checkbox id={id} aria-label="Select all shown" checked={state} onCheckedChange={() => set(ids, state !== true)} />;
  return labelled ? <span className="inline-flex items-center gap-2">{box}<label htmlFor={id} className="text-sm">Select all</label></span> : box;
}

/** Shown while anything is ticked: how many, Add to, and Clear. */
export function ContactSelectionBar({ organizationId }: { organizationId: string }) {
  const { selected, clear } = useSelection();
  const customerIds = useMemo(() => [...selected], [selected]);
  if (!selected.size) return null;
  return <div role="region" aria-label="Selected contacts" className="mb-3 flex flex-wrap items-center gap-2">
    <span className="text-sm font-medium tabular-nums">{selected.size} selected</span>
    <AddToListMenu organizationId={organizationId} target={{ customerIds }} size="small" onAdded={clear} />
    <Button type="button" tone="text" size="small" onClick={clear}>Clear</Button>
  </div>;
}
