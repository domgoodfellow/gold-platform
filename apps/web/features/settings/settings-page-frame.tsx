import type { ReactNode } from 'react';
import { AppPage } from '@/components/layout/app-page';

/** Shared Settings frame. Settings is one shell page, not a shell inside the shell. */
export function SettingsPageFrame({
  children,
}: {
  children: ReactNode;
}) {
  return <AppPage>{children}</AppPage>;
}
