import type { ReactNode } from 'react';

/**
 * A page header's action row: the page's own business actions, then its page-support modes. It
 * never carries workspace destinations — the entered-workspace sidebar owns those, and the header
 * owns page identity, contextual actions and page-local view controls (ADR-048). Actions stay
 * right-aligned and wrap on a narrow canvas.
 */
export function HeaderControls({ children }: { children: ReactNode }) {
  return <div data-header-controls className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 [&>*]:max-w-full [&>*]:shrink-0">
    {children}
  </div>;
}
