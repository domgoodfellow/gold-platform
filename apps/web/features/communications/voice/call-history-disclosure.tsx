'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * Call history beneath the Dialer: secondary to calling, so closed until it is wanted. It opens
 * itself when it is the destination — a `#call-history` link, a filter or a later page — so a
 * link into history never lands on a closed box.
 */
export function CallHistoryDisclosure({ open, summary, children }: { open: boolean; summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== '#call-history' || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: 'start' });
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    const links = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href$="#call-history"]');
      if (anchor && ref.current) ref.current.open = true;
    };
    document.addEventListener('click', links, true);
    return () => {
      window.removeEventListener('hashchange', reveal);
      document.removeEventListener('click', links, true);
    };
  }, []);

  return (
    <details ref={ref} id="call-history" open={open} className="group scroll-mt-20 rounded-lg border border-border bg-surface">
      <summary className={cx('flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden', FOCUS_RING)}>
        {summary}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
