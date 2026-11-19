'use client';

import { useEffect } from 'react';

const QUESTION = 'You have unsaved changes. Leave this editor and discard them?';

/** The part of the browser's Navigation API this hook reads; TypeScript's DOM types do not carry it yet. */
type TraverseEvent = Event & { navigationType: string; cancelable: boolean; destination: { url: string } };
type BrowserNavigation = EventTarget & {
  addEventListener(type: 'navigate', listener: (event: TraverseEvent) => void): void;
  removeEventListener(type: 'navigate', listener: (event: TraverseEvent) => void): void;
};

/**
 * While `dirty`, asks before the page is left:
 * - reload, closing the tab or going Back to another site: the browser's own prompt;
 * - following a link to another page: a confirmation first;
 * - browser Back or Forward to another page of the app: the same confirmation, where the browser
 *   lets a page cancel that move (the Navigation API; Chromium-based browsers today). Elsewhere, or
 *   when the browser marks the move as not cancelable, Back leaves without asking.
 *
 * Back and Forward between addresses of this same page (a phone's steps, a view kept in the
 * address) belong to the page and are never questioned. Programmatic navigation is not covered.
 * The one page-level guard: every page editor with a draft to protect uses it.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!window.confirm(QUESTION)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const traverse = (event: TraverseEvent) => {
      if (event.navigationType !== 'traverse' || !event.cancelable) return;
      const destination = new URL(event.destination.url);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) return;
      if (!window.confirm(QUESTION)) event.preventDefault();
    };
    const history = (window as Window & { navigation?: BrowserNavigation }).navigation;
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', navigate, true);
    history?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', navigate, true);
      history?.removeEventListener('navigate', traverse);
    };
  }, [dirty]);
}
