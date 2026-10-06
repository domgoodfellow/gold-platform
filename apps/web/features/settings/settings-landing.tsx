import { DividedList } from '@/components/surfaces/section';
import { SettingsNavigationRow } from './settings-navigation-row';
import { settingsScopeHref, settingsScopesFor, type SettingsScopeKey } from '@/lib/route/settings';

const SCOPE_DESCRIPTIONS: Record<SettingsScopeKey, string> = {
  organization: 'Business, work, pricing, customers, branding and the channels this business configures.',
  account: 'Your own identity and how you sign in.',
  access: 'Who works here, invitations and roles.',
  connections: 'The outside apps this business connects, and the data it brings in.',
  plan: 'What this business is entitled to, what it has used, and its commercial status.',
};

/**
 * The Settings landing page's body: five destinations chosen from Settings, not five tabs that
 * follow a reader through every page beneath them (the retired `SettingsScopeNav`). Same visual
 * shape as `SettingsIndex` — a divided list, one link per row — so the landing page reads as the
 * same system as the Organization directory it opens into.
 */
export function SettingsLanding({ organizationId }: { organizationId: string }) {
  const scopes = settingsScopesFor(organizationId);

  return (
    <DividedList className="border-y border-border">
      {scopes.map((scope) => (
        <SettingsNavigationRow
          key={scope.key}
          href={settingsScopeHref(scope.key, organizationId)}
          title={scope.label}
          description={SCOPE_DESCRIPTIONS[scope.key]}
        />
      ))}
    </DividedList>
  );
}
