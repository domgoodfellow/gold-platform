'use client';

import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';
import { useVisualAppearance } from './visual-scope';

/**
 * Error toasts stay until the person closes them; success and info toasts still close on their
 * own. Every caller raises toasts through Sonner's one shared `toast`, so this is set here, once,
 * rather than at each call site. A caller that passes its own `duration` still wins.
 *
 * Where a later notification history would collect toasts: every toast passes through this module,
 * and Sonner calls a toast's `onDismiss` (closed by the person) and `onAutoClose` (expired). Adding
 * those two callbacks here, alongside `duration`, is the one place to record them.
 */
const STICKY_ERRORS = Symbol.for('gildops.toast.sticky-errors');
type Marked = typeof toast & { [STICKY_ERRORS]?: true };
if (!(toast as Marked)[STICKY_ERRORS]) {
  const raise = toast.error;
  toast.error = (message, data) => raise(message, { duration: Infinity, ...data });
  (toast as Marked)[STICKY_ERRORS] = true;
}

/**
 * The one toast surface, for ephemeral feedback only — "Saved", "Copied", "Sent" — never a
 * persistent condition, which is `Alert`'s job instead. Every toast has a close button with an
 * accessible name, reachable by keyboard (Sonner's hotkey, Alt+T, moves focus to the toasts).
 *
 * Reads the enclosing semantic scope. With no explicit theme Sonner follows the system.
 */
export function Toaster(props: ToasterProps) {
  const selection = useVisualAppearance();
  return (
    <Sonner
      theme={selection.appearance ?? 'system'}
      className="toaster group"
      closeButton
      toastOptions={{ closeButtonAriaLabel: 'Close notification' }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
