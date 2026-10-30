'use client';

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { financeChoices, financeMutation, financeReview, type FinanceActionState, type FinanceChoicesResult } from '@/app/organizations/[organizationId]/finance/actions';

type Kind = 'invoice' | 'quote' | 'payment';
export type FinanceReview = Awaited<ReturnType<typeof financeReview>>;

/**
 * The record half of a Finance dialog: search the eligible records, choose one, and load what it
 * holds for review. A preselected record skips the search. Responses that arrive after the person
 * has moved on are dropped, so a slow search never replaces a newer one. `reload` re-reads the
 * chosen record after a successful write, so the review shows what was just recorded.
 */
export function useFinanceRecord(organizationId: string, kind: Kind, initialId?: string, options: { includeSettled?: boolean } = {}) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(initialId ?? '');
  const [choices, setChoices] = useState<FinanceChoicesResult | null>(null);
  // Keyed by the record it was loaded for, so a stale answer is never shown for a newer choice.
  const [loaded, setLoaded] = useState<{ id: string; review: FinanceReview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [version, setVersion] = useState(0);
  const includeSettled = options.includeSettled ?? false;
  useEffect(() => {
    if (initialId) return;
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      financeChoices(organizationId, kind, q, { includeSettled })
        .then(result => { if (active) { setChoices(result); setError(null); } })
        .catch(() => { if (active) setError('Records could not be loaded. Try searching again.'); })
        .finally(() => { if (active) setSearching(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, kind, q, initialId, includeSettled]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    financeReview(organizationId, selected)
      .then(result => { if (active) { setLoaded({ id: selected, review: result }); setError(null); } })
      .catch(() => { if (active) setError('This record could not be loaded. Choose another.'); });
    return () => { active = false; };
  }, [organizationId, selected, version]);
  const review = selected && loaded?.id === selected ? loaded.review : null;
  const loadingReview = Boolean(selected) && !review && !error;
  const reload = useCallback(() => setVersion(value => value + 1), []);
  const choose = useCallback((id: string) => setSelected(id), []);
  return { q, setQ, selected, choose, choices, review, error, searching, loadingReview, reload, fixed: Boolean(initialId) };
}

/**
 * The write half: one submission at a time through the existing `financeMutation`, sent in a
 * transition from controlled fields so a refusal keeps every typed value, with focus moved to the
 * refusal so it is read. `onResult` runs once per answer, as part of the action that received it.
 */
export function useFinanceSubmit(onResult?: (state: FinanceActionState) => void) {
  const handler = useRef(onResult);
  useEffect(() => { handler.current = onResult; }, [onResult]);
  const [state, action, pending] = useActionState(async (previous: FinanceActionState, data: FormData) => {
    const next = await financeMutation(previous, data);
    handler.current?.(next);
    return next;
  }, { error: null } as FinanceActionState);
  const [, start] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error && !pending) errorRef.current?.focus(); }, [state, pending]);
  const submit = useCallback((fields: Record<string, string>) => {
    if (pending) return;
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    start(() => action(data));
  }, [action, pending]);
  return { state, pending, submit, errorRef };
}

export function choiceStatus(searching: boolean, choices: { total: number; rows: unknown[] } | null, noun: string) {
  if (searching || !choices) return 'Searching…';
  if (choices.total > choices.rows.length) return `Showing ${choices.rows.length} of ${choices.total} ${noun}. Refine your search.`;
  return `${choices.total} matching ${noun}.`;
}
