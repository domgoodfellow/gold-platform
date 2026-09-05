import type { ComponentProps, ElementType, ReactNode } from 'react';
import { cx } from '../class-names';

/**
 * The two containers `ui-spec.md` §5 names and the application did not have.
 *
 * §5 lists cards for "lists of jobs, customers, resources, invoices" and sheets for "filters,
 * quick actions, status changes, small forms". Neither existed: every list was rows separated by
 * a rule, and every small form was rendered permanently at the bottom of the screen it belonged
 * to. The second is the worse of the two — a list of forty customers ended with a create form,
 * so the page's own content was whatever was left after the form, and *what is on this screen*
 * was answered by a thing you use once a week.
 *
 * **`Disclosure` is a sheet that costs nothing.** It is `<details>` and `<summary>`, which the
 * browser opens, closes, focuses, labels and reaches by keyboard with no state, no effect, no
 * focus trap and no escape-key handler of ours. `OrgNav` already refused a drawer on exactly
 * this reasoning — a drawer "needs state, a toggle, a focus trap and an escape key to be
 * correct" — and the same argument settles this the other way, because the element that does all
 * four already ships in the platform.
 *
 * **`as` exists for the same reason `DividedList`'s does**: the callers are not all divs. A
 * bookable service is a `<section>` and an automation rule is an `<article>`, and rendering
 * either as a div would take a landmark out of the document to gain nothing.
 */
export function Card<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: { as?: T } & Omit<ComponentProps<'div'>, 'ref'>) {
  const Element = (as ?? 'div') as ElementType;
  return <Element {...props} className={cx('rounded border border-border p-4', className)} />;
}

/**
 * A form or a detail that is available rather than always on screen.
 *
 * `summary` is the trigger and reads as an action — *Add a customer*, not *Customer form* —
 * because it is the thing a person came to do and the only word they will read before clicking.
 *
 * **The prop is `defaultOpen`, and this is a naming fix rather than a behaviour one.** It was
 * called `open`, which is what the DOM attribute is called and implies this element is
 * controlled — it is not, and must not become so: the browser owns the open state once a reader
 * has touched it, which is the entire reason for using `<details>` instead of `useState`.
 *
 * The behaviour was already right and it is worth writing down why, because it looks wrong.
 * React writes the attribute only when the prop's value *changes between renders*, so a reader
 * who opens a panel and then submits the form inside it does not have it shut underneath them:
 * the value went `false` → `false` and React never touched the DOM. The one case where it does
 * change is a list going from empty to not — the panel closes, having just been used
 * successfully, which is the right thing to happen anyway.
 *
 * It starts open when a screen has nothing to list, so an empty screen shows the form that
 * fills it rather than a closed drawer under a sentence saying there is nothing here.
 */
export function Disclosure({
  summary,
  defaultOpen,
  className,
  children,
  ...props
}: Omit<ComponentProps<'details'>, 'title' | 'open'> & {
  summary: ReactNode;
  /** The state it renders in. Read once; the browser owns it afterwards. */
  defaultOpen?: boolean;
}) {
  return (
    <details
      {...props}
      open={defaultOpen}
      className={cx('group rounded border border-border', className)}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none">
        <span className="flex items-center gap-2">
          {/* Rotated rather than swapped for a second glyph, so the open and closed states are
              the same mark in two positions — which is what a reader learns once. */}
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
