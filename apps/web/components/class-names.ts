/**
 * Join class strings, dropping anything absent.
 *
 * Extracted at its third caller in the change that wrote it — `button.tsx`, `inputs.tsx` and
 * `section.tsx` all need it. It is deliberately not a Tailwind class merger: nothing here
 * resolves a conflict between two utilities of the same kind, so a control never sets a
 * property a caller is likely to want different. Width is the example that made the rule —
 * the buttons do not carry `w-fit`, because `w-fit w-full` has no defined winner and the
 * caller that wanted full width would lose silently.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The one focus indicator, for an element the global `:focus-visible` rule in globals.css does not
 * already match (a focusable region or chart, a custom control). It is the same declaration, not a
 * second treatment: a 2px outline in `--focus-color` on the element's own edge, which follows its
 * corner radius and leaves no gap. `--focus-color` is the page's text colour, never a tenant
 * accent, so it stays visible whatever the brand (see palette.ts). `focus-visible` so a mouse click
 * doesn't leave it behind. Never add a ring or offset beside it; set `--focus-offset` to draw it
 * inside an edge that would clip it.
 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[var(--focus-offset,0px)] focus-visible:outline-[color:var(--focus-color)]';

/** The same indicator on a choice whose own input is visually hidden: the visible card or label wrapping it shows the focus. */
export const FOCUS_RING_WITHIN =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-[var(--focus-offset,0px)] has-[:focus-visible]:outline-[color:var(--focus-color)]';
