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
