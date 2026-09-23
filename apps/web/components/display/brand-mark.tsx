import type { ReactNode } from 'react';
import { cx } from '../class-names';

/**
 * One square/rounded identity tile — an uploaded image, a real vendor mark, a caller-supplied
 * icon on a coloured surface, or a monogram letter. Knows nothing about which vendor it is
 * drawing: the mapping from a connector or provider key to a mark, a colour or an icon is
 * feature-owned (`features/integrations/catalogue/connector-icon.tsx`,
 * `features/platform/providers/provider-icon.tsx`, `features/integrations/catalogue/connector-app-icons.tsx`).
 */

const SIZES = {
  small: 'size-5 text-[10px]',
  default: 'size-8 text-sm',
  large: 'size-12 text-lg',
} as const;

export function BrandMark({
  label,
  size = 'default',
  background,
  foreground = '#ffffff',
  src,
  mark,
  icon,
  className,
}: {
  /** The accessible name, and — with no image, mark or icon — the monogram's letter. */
  label: string;
  size?: keyof typeof SIZES;
  /** A CSS colour for the fallback tile's surface. Ignored once `src` or `mark` is given. */
  background?: string;
  foreground?: string;
  /** An uploaded or curated image URL. Highest precedence — never hotlinked by a caller. */
  src?: string | null;
  /**
   * A real, multicolour vendor mark, as inline SVG markup — never fetched, never a hand-typed
   * literal here: every caller reads this from a checked-in generated registry
   * (`features/platform/brand/marks.generated.ts`). Second precedence, below an uploaded `src`:
   * a business's own uploaded logo for a connector always wins over a curated one.
   */
  mark?: { viewBox: string; body: string } | null;
  /** A small glyph shown instead of the monogram letter, on the same coloured surface. */
  icon?: ReactNode;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={cx('shrink-0 rounded object-contain', SIZES[size], className)} />
    );
  }

  if (mark) {
    return (
      <svg
        role="img"
        aria-label={label}
        viewBox={mark.viewBox}
        className={cx('shrink-0', SIZES[size], className)}
        // The registry's own generated markup — never user input, never fetched at runtime.
        dangerouslySetInnerHTML={{ __html: mark.body }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cx('flex shrink-0 items-center justify-center rounded font-semibold', SIZES[size], className)}
      style={{ background: background ?? 'var(--muted)', color: foreground }}
    >
      {icon ?? label.charAt(0).toUpperCase()}
    </span>
  );
}
