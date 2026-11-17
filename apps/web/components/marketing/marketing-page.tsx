import type { ReactNode } from 'react';

/** GildOps' code-authored pages and published homepage share one page rhythm. */
export function MarketingPage({ children, as: Element = 'div' }: { children: ReactNode; as?: 'div' | 'article' }) {
  return <Element data-marketing-page>{children}</Element>;
}

/**
 * One section of a marketing page: spacing and a hook for its kind. It draws no artwork; a section
 * that wants geometry and light composes a `FragmentGroup` around its real content.
 */
export function MarketingSection({ children, kind = 'content' }: { children: ReactNode; kind?: string }) {
  return (
    <div className="marketing-section" data-marketing-section={kind}>
      {children}
    </div>
  );
}
