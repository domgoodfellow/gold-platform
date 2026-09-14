'use client';

import { useMemo, type ReactNode } from 'react';
import { useConfigurePanel } from './workspace-right-rail';

/**
 * Registers a page's Configure panel with the shell's right rail. Renders nothing itself — the
 * rail decides where and how the content actually appears (docked on desktop, a bottom sheet on
 * a phone). `content` is server-rendered JSX handed down as a prop, so the same markup, the same
 * server actions and the same validation run whether it's opened from here or from Settings.
 *
 * Shared by every workspace with a contextual Configure panel (Work, Schedule, Customers,
 * Resources, Locations, Assets), not owned by Work — moved here from `features/work/configuration/`
 * once a second caller needed it (this repo's own rule: extract on the second call, never copy).
 */
export function ConfigureRegistrar({
  title,
  settingsHref,
  children,
}: {
  title: string;
  settingsHref: string;
  children: ReactNode;
}) {
  const panel = useMemo(() => ({ title, settingsHref, content: children }), [title, settingsHref, children]);
  useConfigurePanel(panel);
  return null;
}
