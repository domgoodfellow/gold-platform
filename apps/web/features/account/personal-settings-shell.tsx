import type { ReactNode } from 'react';
import { AccountSectionNav } from '@/features/account/account-section-nav';
import { GlobalFallbackShell } from '@/features/account/global-fallback-shell';
import { OrganizationShell } from '@/features/shell/organization-shell';
import { SettingsScopeNav } from '@/features/settings/settings-scope-nav';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { readLastOrganizationId } from '@/lib/route/landing';
import { loadPersonContext } from '@/lib/route/person-context';

/**
 * The frame both Personal settings pages render inside. Each page calls this itself rather than
 * leaning on a layout, for the reason every organization page calls `requireOrganization` (I12);
 * it hands back what a section needs to render and takes the section as children.
 *
 * **There is one shell, and Personal settings is a page inside it.** Where the person has a
 * business in play — the `?org=` hint, else the business they last worked in — the page renders
 * inside that business's own `OrganizationShell`, so the sidebar, header and Agent do not change
 * when they open it. Where they have none, it renders in the account-only frame every
 * organization-less screen uses. Either way what the page shows and writes is the person's own
 * identity, read from `loadPersonContext`; the shell around it decides nothing about that.
 *
 * The business is a hint, never authority: it is honoured only if it is one of the caller's own
 * memberships, and the shell it selects runs its own membership check again.
 */
export async function PersonalSettingsShell({
  returnOrganizationId,
  children,
}: {
  /** The `?org=` hint. Honoured only if the caller is genuinely a member of that business. */
  returnOrganizationId?: string;
  children: (person: { email: string; hasPassword: boolean }) => ReactNode;
}) {
  const { email, hasPassword, organizations: myOrganizations } = await loadPersonContext();
  const hinted = returnOrganizationId
    ? myOrganizations.find((organization) => organization.id === returnOrganizationId)
    : undefined;
  const lastId = hinted ? null : await readLastOrganizationId();
  const origin = hinted ?? myOrganizations.find((organization) => organization.id === lastId);

  const body = (
    <SettingsPageFrame>
      <SettingsScopeNav organizationId={origin?.id ?? null} active="account" />
      <AccountSectionNav organizationId={origin?.id ?? null} />
      {children({ email, hasPassword })}
    </SettingsPageFrame>
  );

  if (origin) return <OrganizationShell organizationId={origin.id}>{body}</OrganizationShell>;
  return <GlobalFallbackShell>{() => body}</GlobalFallbackShell>;
}
