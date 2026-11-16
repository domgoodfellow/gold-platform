'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { CALL_LIST_VIEWS, type CallListView } from '@/lib/domain/tasks/call-list-views';

/**
 * How the operator is working the call list.
 *
 * - `preview`: choosing a contact prepares the call; the operator presses Call, and afterwards
 *   chooses who is next.
 * - `auto`: the same, except that once a call's outcome is resolved the next eligible contact in
 *   the current view is chosen for them. Nothing is ever dialed for them.
 * - `manual`: a typed number with no Call task, for a member who may dial any number.
 */
export type CallingMode = 'preview' | 'auto' | 'manual';

/**
 * A calling session: an operator's way through the call list, never a second telephone session.
 * It holds what they are looking at (view, search), how they are progressing (mode) and what they
 * have set aside for now: `skipped` calls are hidden until restored, `called` ones stay listed and
 * are not offered again by auto-advance. Nothing here is a task's state: skipping or calling
 * changes no task, and clearing the session loses nothing recorded.
 */
export type CallingSession = { mode: CallingMode; view: CallListView; search: string; skipped: string[]; called: string[] };

const DEFAULT: CallingSession = { mode: 'preview', view: 'all', search: '', skipped: [], called: [] };
const MODES: readonly CallingMode[] = ['preview', 'auto', 'manual'];
/** The most task ids a session remembers in each set; the oldest are forgotten first. */
const REMEMBERED = 200;

const sessions = new Map<string, CallingSession>();
const listeners = new Set<() => void>();
const key = (organizationId: string) => `gildops.calling-session.${organizationId}`;

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))].slice(-REMEMBERED) : [];
}

function parse(raw: string | null): CallingSession {
  if (!raw) return DEFAULT;
  try {
    const stored = JSON.parse(raw) as Partial<CallingSession> | null;
    if (!stored || typeof stored !== 'object') return DEFAULT;
    return {
      mode: MODES.includes(stored.mode as CallingMode) ? stored.mode as CallingMode : DEFAULT.mode,
      view: (CALL_LIST_VIEWS as readonly string[]).includes(stored.view as string) ? stored.view as CallListView : DEFAULT.view,
      search: typeof stored.search === 'string' ? stored.search.slice(0, 120) : '',
      skipped: ids(stored.skipped),
      called: ids(stored.called),
    };
  } catch { return DEFAULT; }
}

/**
 * The session for one business in this tab. Kept in memory so it survives moving between pages,
 * Standard, Focus and the pop-out window (all one page), and in the tab's session storage so it
 * survives a reload. It ends with the tab.
 */
function read(organizationId: string): CallingSession {
  const held = sessions.get(organizationId);
  if (held) return held;
  let stored = DEFAULT;
  try { stored = parse(window.sessionStorage.getItem(key(organizationId))); } catch { /* Storage is unavailable: the session lives in memory only. */ }
  sessions.set(organizationId, stored);
  return stored;
}

function write(organizationId: string, next: CallingSession) {
  sessions.set(organizationId, next);
  try { window.sessionStorage.setItem(key(organizationId), JSON.stringify(next)); } catch { /* As above. */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type CallingSessionChange = Partial<CallingSession> | ((current: CallingSession) => Partial<CallingSession>);

export function useCallingSession(organizationId: string): [CallingSession, (change: CallingSessionChange) => void] {
  const session = useSyncExternalStore(subscribe, () => read(organizationId), () => DEFAULT);
  const update = useCallback((change: CallingSessionChange) => {
    const current = read(organizationId);
    const patch = typeof change === 'function' ? change(current) : change;
    write(organizationId, { ...current, ...patch, skipped: ids(patch.skipped ?? current.skipped), called: ids(patch.called ?? current.called) });
  }, [organizationId]);
  return [session, update];
}

/** Forgets every session held in memory. For tests, which share one module between cases. */
export function resetCallingSessions() {
  sessions.clear();
  try { for (const name of Object.keys(window.sessionStorage)) if (name.startsWith('gildops.calling-session.')) window.sessionStorage.removeItem(name); } catch { /* Nothing stored. */ }
  for (const listener of listeners) listener();
}
