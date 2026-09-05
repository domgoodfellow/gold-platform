import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cx } from '../class-names';

/**
 * The one button.
 *
 * `docs/ui-spec.md` §4 is the record of why this exists: the primary button's class string was
 * written out 15 times, the secondary 12 and a small one 9, and the extraction that had already
 * been attempted produced eleven local `INPUT_CLASS` constants in four spellings. What D23
 * forbids is a second `Button` belonging to one surface — not a second file — so this is the
 * set, extended, and booking does not get its own.
 *
 * **`ButtonLink` exists as of the interface pass, and it did not before.** This paragraph used to
 * say no link in the application was styled as a button, which was true when it was written and
 * had quietly stopped being true: the schedule's day controls, the payment connect link and the
 * booking page's slots were each spelling one out. It is the same tones and sizes, on an anchor,
 * because *navigate somewhere* and *submit something* look identical to a reader and must not be
 * the same element to a browser — a link opens in a new tab, restores on back, and is announced
 * as a link.
 *
 * Tones are named for the weight of the action, never for a business meaning — §6 gives one
 * primary per screen. `danger` is the destructive treatment and does not confirm anything by
 * itself; a confirmation is a dialog, and there are none yet.
 *
 * **No width.** See `cx` for why a control must not set a property the caller is likely to
 * override: the 15 primary call sites pass `w-fit` themselves.
 */
export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'text';
export type ButtonSize = 'default' | 'small' | 'tiny';

/**
 * **`primary` reads the accent, which is where a tenant's colour actually lands.**
 * `--accent` defaults to `--foreground` and `--on-accent` to `--background` (`globals.css`), so
 * a business that has chosen no colour renders exactly what this said before — `bg-foreground
 * text-background` — and one that has chosen gets its own. That default is what makes this a
 * change of one line rather than a branded and an unbranded button.
 *
 * `danger` deliberately keeps its own role. A refusal is the platform saying something went
 * wrong, and a tenant recolouring that is §7's mistake wearing a brand.
 */
const TONE: Record<Exclude<ButtonTone, 'text'>, string> = {
  primary: 'bg-accent text-on-accent',
  secondary: 'border border-border',
  danger: 'border border-border text-danger',
};

const SIZE: Record<ButtonSize, string> = {
  default: 'px-4 py-2',
  small: 'px-3 py-1 text-sm',
  tiny: 'px-2 py-1 text-xs',
};

/**
 * The tertiary treatment §6 names, and the one tone that is not a box.
 *
 * It carries no padding and no corner, so it takes the type scale alone — which is why it is a
 * branch below rather than another entry in `TONE`. It replaced four spellings that varied in
 * both size and weight; the weight is now one role, on the same reasoning that made two reds
 * into one `danger`.
 */
const TEXT_SIZE: Record<ButtonSize, string> = {
  default: '',
  small: 'text-sm',
  tiny: 'text-xs',
};

export function Button({
  tone = 'primary',
  size = 'default',
  className,
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize }) {
  const classes =
    tone === 'text'
      ? cx('underline underline-offset-4 text-muted disabled:opacity-50', TEXT_SIZE[size], className)
      : cx('rounded disabled:opacity-50', TONE[tone], SIZE[size], className);

  return <button {...props} className={classes} />;
}

/**
 * A link that looks like a button.
 *
 * **The element is chosen by what it does, never by how it should look.** A control that changes
 * the page you are on is an anchor: it opens in a new tab on a middle click, it is in the browser's
 * history, and assistive technology announces it as a link. Styling a `<button>` to look like a
 * link — or an anchor to look like a button and then handling clicks in JavaScript — breaks one
 * of those every time.
 */
export function ButtonLink({
  tone = 'secondary',
  size = 'default',
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone; size?: ButtonSize }) {
  const classes =
    tone === 'text'
      ? cx('underline underline-offset-4 text-muted', TEXT_SIZE[size], className)
      : cx('inline-block rounded', TONE[tone], SIZE[size], className);

  return <Link {...props} className={classes} />;
}
