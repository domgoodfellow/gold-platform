'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownLeft, Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { DialerPopoutContext, type PopoutCallDraft } from './dialer-popout-context';
import { NewCallForm } from './new-call-form';
import { useTelephoneDevice } from './telephone-device';
import { loadDialerAction } from '@/app/organizations/[organizationId]/calls/dialer-actions';

/** Only the controls move windows; the organization layout retains the telephone connection. */
export function DialerPopoutProvider({ organizationId, children }: { organizationId: string; children: ReactNode }) {
  const { activeCall, incoming, status } = useTelephoneDevice();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<PopoutCallDraft | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const draftRef = useRef<PopoutCallDraft | undefined>(undefined);
  const popupWindow = useRef<Window | null>(null);
  const updateDraft = useCallback((next: { toNumber: string; phoneNumberId: string }) => {
    if (draftRef.current) draftRef.current = { ...draftRef.current, ...next };
    setDraft((previous) => previous && (previous.toNumber !== next.toNumber || previous.phoneNumberId !== next.phoneNumberId) ? { ...previous, ...next } : previous);
  }, []);

  const close = useCallback(() => setContainer(null), []);
  const open = useCallback((draft?: PopoutCallDraft) => {
    if (popupWindow.current && !popupWindow.current.closed) {
      popupWindow.current.focus();
      return;
    }
    const child = window.open('about:blank', '_blank', 'popup,width=420,height=680,resizable=yes,scrollbars=yes');
    if (!child) {
      setError('Allow pop-ups for GildOps to open the dialer in a separate window.');
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    child.document.title = 'GildOps — Dialer';
    child.document.documentElement.lang = document.documentElement.lang;
    child.document.documentElement.className = document.documentElement.className;
    child.document.body.className = 'flex min-h-screen flex-col bg-background text-foreground antialiased';
    child.document.body.setAttribute('data-brand', '');
    const base = child.document.createElement('base');
    base.href = document.baseURI;
    child.document.head.append(base);
    setError(null);
    setUnavailableReason(null);
    draftRef.current = draft ? { ...draft } : undefined;
    popupWindow.current = child;
    setDraft(draft);
    setContainer(child.document.body);
    setLoading(!draft);
    if (!draft) {
      void loadDialerAction(organizationId).then(options => {
        if (popupWindow.current !== child || child.closed) return;
        const next = { ...options, toNumber: '', phoneNumberId: '' };
        draftRef.current = next;
        setDraft(next);
        setUnavailableReason(options.unavailableReason);
        setLoading(false);
      }).catch(() => {
        if (popupWindow.current !== child || child.closed) return;
        setUnavailableReason('Calling options could not be loaded. Close and reopen the dialer to retry.');
        setLoading(false);
      });
    }
  }, [organizationId]);

  useEffect(() => {
    const child = popupWindow.current;
    if (!container || !child) return;
    // Brand styles live inside the organization shell, and new CSS may arrive on navigation.
    const copies = new Map<Element, Node>();
    const syncStyles = () => {
      const originals = new Set(document.querySelectorAll('style, link[rel="stylesheet"]'));
      for (const [original, copy] of copies) {
        if (!originals.has(original)) {
          copy.parentNode?.removeChild(copy);
          copies.delete(original);
        }
      }
      for (const original of originals) {
        const previous = copies.get(original);
        if (previous?.isEqualNode(original)) continue;
        const copy = original.cloneNode(true);
        if (previous) previous.parentNode?.replaceChild(copy, previous);
        else child.document.head.append(copy);
        copies.set(original, copy);
      }
      child.document.documentElement.className = document.documentElement.className;
      child.document.documentElement.style.cssText = document.documentElement.style.cssText;
      const appearance = document.querySelector('[data-account-appearance]');
      if (appearance) {
        for (const attribute of ['data-visual-system', 'data-visual-preset', 'data-appearance', 'data-density', 'data-motion', 'style']) {
          const value = appearance.getAttribute(attribute);
          if (value === null) child.document.body.removeAttribute(attribute);
          else child.document.body.setAttribute(attribute, value);
        }
      }
    };
    syncStyles();
    const observer = new MutationObserver(syncStyles);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    const brand = document.querySelector('[data-brand]');
    if (brand) observer.observe(brand, { childList: true, attributes: true });
    const appearance = document.querySelector('[data-account-appearance]');
    if (appearance && appearance !== brand) observer.observe(appearance, { attributes: true });
    const themeObserver = new MutationObserver(syncStyles);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    child.addEventListener('pagehide', close);
    const closeWithHost = () => child.close();
    window.addEventListener('pagehide', closeWithHost);
    child.focus();
    child.document.querySelector<HTMLInputElement>('input[type="tel"]')?.focus();
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      child.removeEventListener('pagehide', close);
      window.removeEventListener('pagehide', closeWithHost);
      child.close();
      if (popupWindow.current === child) popupWindow.current = null;
      const draft = draftRef.current;
      if (draft) draft.onReturn?.({ toNumber: draft.toNumber, phoneNumberId: draft.phoneNumberId });
      draftRef.current = undefined;
      const returnFocus = opener.current?.isConnected
        ? opener.current
        : document.querySelector<HTMLElement>('[data-dialer-popout-trigger]');
      returnFocus?.focus();
    };
  }, [container, close]);

  return (
    <DialerPopoutContext.Provider value={{ container, error, open, close, updateDraft }}>
      {children}
      {container ? createPortal(
        <>
          <header className="order-1 flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h1 className="flex items-center gap-2 text-base font-semibold"><Phone aria-hidden className="size-4" /> Dialer</h1>
            <Button tone="secondary" size="small" onClick={close}><ArrowDownLeft aria-hidden /> Return to GildOps</Button>
          </header>
          {!activeCall && !incoming ? (
            <main className="order-2 p-4">
              <div className="mb-4 flex items-center justify-between text-sm">
                <span className="text-muted">Outbound call</span>
                <Badge tone={status === 'ready' ? 'success' : status === 'error' ? 'danger' : 'neutral'}>{status === 'ready' ? 'Connected' : status === 'error' ? 'Connection failed' : status === 'connecting' ? 'Connecting' : 'Connects when you call'}</Badge>
              </div>
              {loading ? <p role="status" className="text-sm text-muted">Loading calling options…</p> : null}
              {unavailableReason ? <p role="status" className="mb-3 text-sm text-muted">{unavailableReason}</p> : null}
              {draft ? <NewCallForm key={organizationId} organizationId={organizationId} {...draft} compact /> : null}
            </main>
          ) : null}
          <p className="order-3 mt-auto px-4 py-3 text-xs text-muted">Keep the main GildOps window open while calling.</p>
        </>, container,
      ) : null}
    </DialerPopoutContext.Provider>
  );
}
