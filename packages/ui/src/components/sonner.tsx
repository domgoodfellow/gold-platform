'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * The one toast surface, for ephemeral feedback only — "Saved", "Copied", "Sent" — never a
 * persistent condition, which is `Alert`'s job instead.
 *
 * `theme="system"` rather than a `next-themes` read: this repository has no theme toggle, only
 * `prefers-color-scheme`, and sonner already reads that itself under `"system"`.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
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
