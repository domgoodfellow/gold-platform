'use client';

import { useMemo, type ReactNode } from 'react';
import { useConfigurePanel } from '@/components/containers/workspace-right-rail';

/**
 * Registers a page's Configure panel with the shell's right rail. Renders nothing itself — the
 * rail decides where and how the content actually appears (docked on desktop, a bottom sheet on
 * a phone). `content` is server-rendered JSX handed down as a prop, so the same markup, the same
 * server actions and the same validation run whether it's opened from here or from Settings.
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
