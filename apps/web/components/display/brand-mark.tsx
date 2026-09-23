import type { ReactNode } from 'react';
import { cx } from '../class-names';

/**
 * One square/rounded identity tile — an uploaded image, a caller-supplied icon on a coloured
 * surface, or a monogram letter. Knows nothing about which vendor it is drawing: the mapping
 * from a connector or provider key to a colour and an icon is feature-owned
 * (`features/integrations/catalogue/connector-icon.tsx`, `features/platform/providers/provider-icon.tsx`).
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
  icon,
  className,
}: {
  /** The accessible name, and — with no image or icon — the monogram's letter. */
  label: string;
  size?: keyof typeof SIZES;
  /** A CSS colour for the fallback tile's surface. Ignored once `src` is given. */
  background?: string;
  foreground?: string;
  /** An uploaded or curated image URL. Highest precedence — never hotlinked by a caller. */
  src?: string | null;
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
