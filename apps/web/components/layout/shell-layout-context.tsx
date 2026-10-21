'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SidebarPreferences } from '@gold/ui/components/sidebar-preferences';

const ShellLayoutContext = createContext<SidebarPreferences>({ open: true, viewport: 'desktop' });

/** Carries the server-read sidebar preferences (`readShellLayout`) down to `AppShell`. */
export function ShellLayoutProvider({ value, children }: { value: SidebarPreferences; children: ReactNode }) {
  return <ShellLayoutContext.Provider value={value}>{children}</ShellLayoutContext.Provider>;
}

export function useShellLayout() {
  return useContext(ShellLayoutContext);
}
