'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useVisualAppearance } from './visual-scope';

/**
 * The one toast surface, for ephemeral feedback only — "Saved", "Copied", "Sent" — never a
 * persistent condition, which is `Alert`'s job instead.
 *
 * Reads the enclosing semantic scope. With no explicit theme Sonner follows the system.
 */
export function Toaster(props: ToasterProps) {
  const selection = useVisualAppearance();
  return (
    <Sonner
      theme={selection.appearance ?? 'system'}
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
