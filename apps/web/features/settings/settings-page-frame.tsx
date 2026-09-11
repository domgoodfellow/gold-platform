import type { ReactNode } from 'react';
import { AppPage } from '@/components/containers/app-page';
import { SettingsNavigation } from './settings-navigation';

/** Shared local-navigation frame for Settings landing and detail routes. */
export function SettingsPageFrame({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  return (
    <AppPage width="wide">
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNavigation organizationId={organizationId} />
        <div className="min-w-0">{children}</div>
      </div>
    </AppPage>
  );
}
