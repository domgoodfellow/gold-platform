'use client';

import Link from 'next/link';
import { cx, FOCUS_RING } from '@/components/class-names';
import { settingsScopeHref, settingsScopesFor, type SettingsScopeKey } from '@/lib/route/settings';

/**
 * The one tab bar every Settings scope renders — Organization, Account, Access, Connections and
 * Plan & usage are sections of one Settings system, not five applications (`CLAUDE.md`). It draws
 * once at the head of whichever scope's page is current, names that scope in one line, and links
 * to the others. `active` is never inferred from the pathname: a scope's own page always knows
 * which one it is.
 */
export function SettingsScopeNav({
  organizationId,
  organizationName,
  active,
}: {
  organizationId: string | null;
  organizationName?: string;
  active: SettingsScopeKey;
}) {
  const scopes = settingsScopesFor(organizationId);
  const current = scopes.find((scope) => scope.key === active) ?? scopes[0];

  return (
    <div className="mb-6 flex flex-col gap-3">
      <p className="text-sm text-muted">{current.scopeCopy(organizationName)}</p>
      {scopes.length > 1 ? (
        <nav aria-label="Settings" className="flex gap-1 border-b border-border">
          {scopes.map((scope) => (
            <Link
              key={scope.key}
              href={settingsScopeHref(scope.key, organizationId)}
              aria-current={scope.key === active ? 'page' : undefined}
              className={cx(
                FOCUS_RING,
                '-mb-px border-b-2 px-3 py-2 text-sm',
                scope.key === active ? 'border-foreground font-medium' : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              {scope.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
