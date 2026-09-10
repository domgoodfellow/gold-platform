import type { ComponentProps, ElementType, ReactNode } from 'react';
import { cx, FOCUS_RING } from '../class-names';

/** `as` because callers aren't all divs — a bookable service is a `<section>`, a rule an `<article>`. */
export function Card<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: { as?: T } & Omit<ComponentProps<'div'>, 'ref'>) {
  const Element = (as ?? 'div') as ElementType;
  return <Element {...props} className={cx('rounded border border-border p-4', className)} />;
}

/**
 * A form or detail that's collapsible rather than always on screen. `<details>` gives open/close,
 * focus, and keyboard handling for free.
 *
 * `defaultOpen`, not `open`: the browser owns the state once a reader has touched it.
 */
export function Disclosure({
  summary,
  tone = 'default',
  defaultOpen,
  className,
  children,
  ...props
}: Omit<ComponentProps<'details'>, 'title' | 'open'> & {
  summary: ReactNode;
  /** Primary is for the screen's one leading disclosure action, never a section-local form. */
  tone?: 'default' | 'primary';
  defaultOpen?: boolean;
}) {
  return (
    <details
      {...props}
      open={defaultOpen}
      className={cx('group rounded border border-border', className)}
    >
      <summary
        className={cx(
          'cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none',
          tone === 'primary' && 'bg-accent text-on-accent',
          FOCUS_RING,
        )}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-subtle transition-transform group-open:rotate-90">
            ›
          </span>
          {summary}
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}
