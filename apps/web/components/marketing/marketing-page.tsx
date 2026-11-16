import type { ReactNode } from 'react';
import { KintsugiFracture, type FractureVariant } from './kintsugi-fracture';

/** GildOps' code-authored pages and published homepage share one visual composition. */
export function MarketingPage({ children, as: Element = 'div' }: { children: ReactNode; as?: 'div' | 'article' }) {
  return <Element data-marketing-page>{children}</Element>;
}

export function productFracture(index: number): FractureVariant {
  return (['products', 'automation', 'connected'] as const)[index % 3]!;
}

/** Keeps repair junctions aligned while content, forms and semantics stay with their owner. */
export function MarketingSection({ children, kind = 'content', variant = 'bridge' }: {
  children: ReactNode;
  kind?: string;
  variant?: FractureVariant;
}) {
  return (
    <div className="marketing-section" data-marketing-section={kind}>
      <KintsugiFracture variant={variant} />
      <div className="marketing-section-content">{children}</div>
    </div>
  );
}
