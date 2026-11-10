'use client';

import { usePathname } from 'next/navigation';
import { ButtonLink } from '@/components/controls/button';

/**
 * The small-screen persistent conversion surface, so the primary action stays in view on a phone
 * without a scroll back to the header. Not drawn on the consultation form itself, where it would
 * only lead back to the page the visitor is already filling in.
 */
export function MobileDemoCta() {
  if (usePathname() === '/demo') return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-surface/95 p-3 backdrop-blur sm:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <p className="min-w-0 truncate text-xs text-muted">Tell us what you need help with.</p>
      <ButtonLink href="/demo" tone="primary" size="small" className="shrink-0">
        Request a consultation
      </ButtonLink>
    </div>
  );
}
