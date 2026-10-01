import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { DividedList } from '@/components/surfaces/section';
import { FOCUS_RING } from '@/components/class-names';
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
        <li key={scope.key} className="relative flex items-center gap-4 py-3 transition-colors hover:bg-hover">
          <div className="min-w-0 flex-1">
            <Link
              href={settingsScopeHref(scope.key, organizationId)}
              className={`${FOCUS_RING} rounded font-medium after:absolute after:inset-0`}
            >
              {scope.label}
            </Link>
            <p className="mt-0.5 text-sm text-muted">{SCOPE_DESCRIPTIONS[scope.key]}</p>
          </div>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
        </li>
      ))}
    </DividedList>
  );
}
