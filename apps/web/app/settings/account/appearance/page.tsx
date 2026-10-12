import { SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { AppearanceEditor } from '@/features/appearance/appearance-editor';
import { getAppearance } from '@/lib/domain/identity/appearance';
import { getDb } from '@/lib/db/server';

export const dynamic = 'force-dynamic';
export default async function AppearancePage({ searchParams }: PageProps<'/settings/account/appearance'>) {
  const { org } = await searchParams;
  const selection = await getAppearance(await getDb());
  return <PersonalSettingsShell returnOrganizationId={typeof org === 'string' ? org : undefined}>
    {({ organizationId }) => <div className="space-y-6"><SettingsPageHeader title="Appearance" />
      {!organizationId && <AccountSectionNav organizationId={organizationId} />}
      <AppearanceEditor saved={selection} />
    </div>}
  </PersonalSettingsShell>;
}
