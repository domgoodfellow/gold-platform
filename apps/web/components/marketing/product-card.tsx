import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FOCUS_RING, cx } from '@/components/class-names';
import type { Product } from '@/lib/marketing/content';

/** The homepage's three commercial doors. Sells the outcome first; the product name is the door's label. */
export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={product.href}
      className={cx(
        'group flex flex-col gap-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-foreground/40',
        FOCUS_RING,
      )}
    >
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{product.name}</p>
      <h3 className="text-xl font-semibold tracking-tight">{product.outcome}</h3>
      <p className="text-sm leading-relaxed text-muted">{product.summary}</p>
      <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
        Explore {product.name}
        <ArrowRight aria-hidden size={14} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
