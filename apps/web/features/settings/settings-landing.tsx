'use client';

import { useState } from 'react';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { TextInput } from '@/components/controls/inputs';
import type { SettingsSection } from './settings-map';
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
export function SettingsLanding({ organizationId, statuses, sections = [] }: { organizationId: string; statuses?: Partial<Record<SettingsScopeKey, string>>; sections?: SettingsSection[] }) {
  const scopes = settingsScopesFor(organizationId);
  const [search, setSearch] = useState('');
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, '');
  const query = normalize(search.trim());
  const matches = scopes.filter((scope) => normalize(`${scope.label} ${SCOPE_DESCRIPTIONS[scope.key]}`).includes(query));
  const results = query ? sections.flatMap((section) => section.entries).filter((entry) => normalize(`${entry.title} ${entry.description}`).includes(query)) : [];

  return (
    <div>
    <TextInput aria-label="Search settings" placeholder="Search settings" value={search} onChange={(event) => setSearch(event.target.value)} className="mb-4" />
    <DividedList className="border-y border-border">
      {matches.map((scope) => (
        <SettingsNavigationRow
          key={scope.key}
          href={settingsScopeHref(scope.key, organizationId)}
          title={scope.label}
          description={SCOPE_DESCRIPTIONS[scope.key]}
          status={statuses?.[scope.key]}
        />
      ))}
      {results.map((entry) => <SettingsNavigationRow key={entry.key} href={`/organizations/${organizationId}/${entry.path}`} title={entry.title} description={entry.description} />)}
    </DividedList>
    {!matches.length && !results.length ? <EmptyState>No settings match “{search}”. Try another search.</EmptyState> : null}
    </div>
  );
}
