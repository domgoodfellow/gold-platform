import type { ReactNode } from 'react';
import { SettingsHeader } from '@/components/patterns/settings-header';
import type { PageHeaderCrumb } from '@/components/headers/page-header';
import { settingsScopeHref, settingsScopesFor, type SettingsScopeKey } from '@/lib/route/settings';

/**
 * One coherent Settings identity for whichever scope's page is current — title, location and the
 * scope tabs together, through `SettingsHeader` (`docs/ui-spec.md` §2a). Organization, Account,
 * Access, Connections and Plan & usage are sections of one Settings system, not five applications
 * (`CLAUDE.md`); `active` is never inferred from the pathname — a scope's own page always knows
 * which one it is.
 *
 * `title` is omitted only by `PersonalSettingsShell`, whose two pages (Profile, Security &
 * sign-in) each draw their own heading beneath these tabs — see `SettingsHeader`. Every other
 * caller passes its own `title`/`crumbs`.
 */
export function SettingsScopeNav({
  organizationId,
  active,
  title,
  crumbs,
  meta,
  actions,
}: {
  organizationId: string | null;
  active: SettingsScopeKey;
  title?: string;
  crumbs?: PageHeaderCrumb[];
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const scopes = settingsScopesFor(organizationId);

  return (
    <SettingsHeader
      title={title}
      crumbs={crumbs}
      active={active}
      meta={meta}
      actions={actions}
      scopes={scopes.map((scope) => ({
        key: scope.key,
        label: scope.label,
        href: settingsScopeHref(scope.key, organizationId),
      }))}
    />
  );
}
