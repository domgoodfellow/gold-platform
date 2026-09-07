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
 * The one focus ring, shared by every interactive control (M11). `--accent-text`, not `--accent`
 * — a tenant's accent can be too close to the page to read against, and the ring is the one thing
 * whose job is to stay visible (see palette.ts). `focus-visible` so a mouse click doesn't leave a
 * ring on a control that was only clicked, not tabbed to.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-background';
