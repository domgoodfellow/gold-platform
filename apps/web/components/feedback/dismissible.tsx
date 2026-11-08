'use client';

import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/controls/button';

/**
 * A persistent notice a person may close until what it is about changes.
 *
 * `signature` describes the notice's current facts (for setup, how many steps remain). Closing
 * stores that signature; the notice stays hidden while the signature is the same and returns as
 * soon as it differs. Kept for this browser session only: there is no per-person preference store
 * for this yet, and a closed notice must never hide a condition for good. Safety-critical notices
 * and anything that blocks an action are never closable, so never use this for them.
 */
const CHANGED = 'gildops:dismissed-changed';
const storageKey = (key: string) => `gildops:dismissed:${key}`;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGED, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useDismissal(key: string, signature: string): { dismissed: boolean; dismiss: () => void } {
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);
  const dismiss = () => {
    try {
      sessionStorage.setItem(storageKey(key), signature);
    } catch {
      // Storage refused (private window, blocked site data): the notice simply stays.
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  return { dismissed: stored === signature, dismiss };
}

/** The close control for a dismissible notice: the shared ghost Button, an × with an accessible name. */
export function DismissButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button type="button" tone="ghost" size="small" aria-label={label} onClick={onClick} className={className}>
      <X aria-hidden />
    </Button>
  );
}
