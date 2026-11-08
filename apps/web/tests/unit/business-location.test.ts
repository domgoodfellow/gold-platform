import { describe, expect, it } from 'vitest';
import { listCountries, listRegions, postalCodeValid, suggestRegionalDefaults, timeZoneLabel } from '@/lib/domain/tenancy/regional-defaults';
import { normaliseWebsite, validateIdentity, missingIdentity, EMPTY_IDENTITY } from '@/lib/domain/tenancy/identity';
import { safeAppReturnPath } from '@/lib/route/app-return';
import { defaultSettingsHref, inSettingsContext, projectSettingsNav, settingsSearchItems, workspaceConfigCrumbs } from '@/lib/settings-nav';
import { HELP_ARTICLES, searchHelp } from '@/lib/help/articles';
import { SETTINGS_SECTIONS } from '@/features/settings/settings-map';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';

const ORG = '22222222-2222-4222-8222-222222222222';

describe('regional defaults follow the business location', () => {
  it('proposes Eastern Time and CAD for Montreal, Quebec', () => {
    expect(suggestRegionalDefaults({ countryCode: 'CA', regionCode: 'QC' })).toMatchObject({ timeZone: 'America/Toronto', currencyCode: 'CAD', source: 'regional_mapping', requiresConfirmation: false });
  });

  it('proposes Pacific Time for Vancouver, whatever the browser says', () => {
    expect(suggestRegionalDefaults({ countryCode: 'CA', regionCode: 'BC', browserTimeZone: 'America/Toronto' }).timeZone).toBe('America/Vancouver');
  });

  it('proposes New York for New York and USD', () => {
    expect(suggestRegionalDefaults({ countryCode: 'US', regionCode: 'NY' })).toMatchObject({ timeZone: 'America/New_York', currencyCode: 'USD' });
  });

  it('asks for confirmation where a state spans more than one zone', () => {
    expect(suggestRegionalDefaults({ countryCode: 'US', regionCode: 'TX' }).requiresConfirmation).toBe(true);
  });

  it('does not invent a zone for a multi-zone country with no region', () => {
    const result = suggestRegionalDefaults({ countryCode: 'CA' });
    expect(result.timeZone).toBeUndefined();
    expect(result.requiresConfirmation).toBe(true);
  });

  it('uses the browser only as a flagged fallback for a country it has no mapping for', () => {
    expect(suggestRegionalDefaults({ countryCode: 'BR', browserTimeZone: 'America/Sao_Paulo' })).toMatchObject({ timeZone: 'America/Sao_Paulo', source: 'browser_fallback', requiresConfirmation: true });
  });

  it('suggests the euro across the euro area and nothing for a country it does not know', () => {
    expect(suggestRegionalDefaults({ countryCode: 'FR' })).toMatchObject({ currencyCode: 'EUR', timeZone: 'Europe/Paris' });
    const unknown = suggestRegionalDefaults({ countryCode: 'ZZ' });
    expect(unknown).toMatchObject({ source: 'none', requiresConfirmation: true });
    expect(unknown.currencyCode).toBeUndefined();
  });

  it('lists countries by name, offers regions only where the list is closed, and labels zones for people', () => {
    expect(listCountries().find((country) => country.code === 'CA')?.name).toBe('Canada');
    expect(listRegions('CA').map((region) => region.code)).toContain('QC');
    expect(listRegions('FR')).toEqual([]);
    expect(timeZoneLabel('America/Toronto')).toMatch(/Eastern.*Toronto/);
  });

  it('checks a postal code only where the format is known', () => {
    expect(postalCodeValid('CA', 'H2X 1Y4')).toBe(true);
    expect(postalCodeValid('CA', '12345')).toBe(false);
    expect(postalCodeValid('US', '10001')).toBe(true);
    expect(postalCodeValid('JP', '100-0001')).toBe(true);
  });
});

describe('business identity rules', () => {
  const base = { ...EMPTY_IDENTITY, legalName: '', industry: '', countryCode: '', region: '', city: '', postalCode: '', addressLine1: '', addressLine2: '', contactEmail: '', contactPhone: '', websiteUrl: '' } as Record<string, string>;

  it('normalises a bare website to https and refuses other schemes', () => {
    expect(normaliseWebsite('example.com')).toBe('https://example.com');
    expect(normaliseWebsite('')).toBe('');
    expect(() => normaliseWebsite('javascript:alert(1)')).toThrow();
    expect(() => normaliseWebsite('ftp://example.com')).toThrow();
  });

  it('wants a country and city before a street address, and a plausible email', () => {
    const input = base as never;
    expect(() => validateIdentity({ ...(input as object), addressLine1: '1 Main St' } as never)).toThrow(/country and a city/);
    expect(() => validateIdentity({ ...(input as object), contactEmail: 'nope' } as never)).toThrow(/email/);
    expect(validateIdentity({ ...(input as object), countryCode: 'ca', city: 'Montreal' } as never).countryCode).toBe('CA');
  });

  it('calls a profile incomplete only for location and industry, never the legal name', () => {
    expect(missingIdentity(EMPTY_IDENTITY)).toEqual(['country', 'city', 'industry']);
    expect(missingIdentity({ ...EMPTY_IDENTITY, countryCode: 'CA', city: 'Montreal', industry: 'Auto repair' })).toEqual([]);
  });
});

describe('the Settings context', () => {
  const everything = { capabilities: new Set(CAPABILITIES), enabledModules: new Set<string>(), featureAvailability: new Set<string>() };

  it('groups cross-workspace administration under Personal, Organization and Administration', () => {
    const sections = projectSettingsNav(ORG, everything);
    expect(sections.map((section) => [section.label, section.items.map((item) => item.label)])).toEqual([
      ['Personal', ['Profile', 'Security & sign-in', 'Appearance']],
      // No module is enabled here, so Customer payments (billing-entitled) is absent.
      ['Organization', ['General', 'Branding', 'Domains', 'Email sending', 'Features', 'Words & navigation']],
      ['Administration', ['Team & access', 'Connections', 'Plan & usage']],
    ]);
  });

  it('offers workspace configuration nowhere in the navigation', () => {
    const hrefs = projectSettingsNav(ORG, everything).flatMap((section) => section.items.map((item) => item.href)).join(' ');
    for (const owned of ['pricing', 'work/configuration', 'schedule/configuration', 'comms/configuration/calling', 'sales-stages', 'ai/agents', 'automations/rules']) {
      expect(hrefs).not.toContain(owned);
    }
  });

  it('shows a restricted member only what their role may configure, and always their own account', () => {
    const sections = projectSettingsNav(ORG, { ...everything, capabilities: new Set(['customer.create' as const]) });
    expect(sections.map((section) => section.label)).toEqual(['Personal']);
    expect(defaultSettingsHref(sections)).toContain('/settings/account');
  });

  it('lands an administrator on General', () => {
    expect(defaultSettingsHref(projectSettingsNav(ORG, everything))).toBe(`/organizations/${ORG}/settings/general`);
  });

  it('knows Settings pages from workspace-owned configuration pages', () => {
    for (const path of ['settings', 'settings/general', 'settings/access/roles', 'settings/connections/mcp', 'settings/plan']) expect(inSettingsContext(`/organizations/${ORG}/${path}`, ORG), path).toBe(true);
    expect(inSettingsContext('/settings/account/security', ORG)).toBe(true);
    for (const path of ['finance/configuration/pricing', 'comms/configuration/calling', 'work/configuration', 'finance', 'settings/public-profile']) expect(inSettingsContext(`/organizations/${ORG}/${path}`, ORG), path).toBe(false);
  });

  it('searches both Settings destinations and the configuration workspaces own, each routed to its owner', () => {
    const sections = projectSettingsNav(ORG, everything);
    const items = settingsSearchItems(ORG, sections, SETTINGS_SECTIONS.flatMap((section) => section.entries));
    const hours = items.find((item) => item.label === 'Working hours');
    expect(hours?.href).toBe(`/organizations/${ORG}/schedule/configuration`);
    expect(hours?.description).toBe('In Work');
    expect(items.find((item) => item.label === 'Team & access')?.href).toBe(`/organizations/${ORG}/settings/access`);
    // The business profile is found once, as the Settings destination, not again as workspace configuration.
    expect(items.filter((item) => item.label === 'General')).toHaveLength(1);
  });

  it('points workspace configuration pages back at their workspace', () => {
    expect(workspaceConfigCrumbs(ORG, 'call-setup')).toEqual([{ label: 'Communications', href: `/organizations/${ORG}/comms` }, { label: 'Settings' }]);
    // The price book is Finance's operating page, never under a Configuration crumb.
    expect(workspaceConfigCrumbs(ORG, 'price-book')).not.toContainEqual({ label: 'Settings' });
    expect(workspaceConfigCrumbs(ORG, 'custom-fields')).toEqual([]);
  });
});

describe('Back to app only returns somewhere safe', () => {
  it('does not let an authorized workspace root authorize a restricted nested configuration or operating area', () => {
    expect(safeAppReturnPath(`/organizations/${ORG}/comms/configuration/email`, ORG, [`/organizations/${ORG}/comms/configuration`, `/organizations/${ORG}/comms/configuration/calling`])).toBeNull();
    expect(safeAppReturnPath(`/organizations/${ORG}/finance/invoices`, ORG, [`/organizations/${ORG}/finance`])).toBeNull();
    expect(safeAppReturnPath(`/organizations/${ORG}/comms/configuration`, ORG, [`/organizations/${ORG}/comms/configuration`])).toBe(`/organizations/${ORG}/comms/configuration`);
  });
  it('accepts a page of this business', () => {
    expect(safeAppReturnPath(`/organizations/${ORG}/finance/invoices`, ORG)).toBe(`/organizations/${ORG}/finance/invoices`);
  });

  it.each([
    'https://evil.example/organizations/' + ORG + '/x',
    '//evil.example',
    `/organizations/${ORG}/..\\x`,
    '/organizations/other-org/finance',
    `/organizations/${ORG}/settings/general`,
    `/organizations/${ORG}/a\nb`,
    '',
    null,
  ])('refuses %j', (candidate) => {
    expect(safeAppReturnPath(candidate as string | null, ORG)).toBeNull();
  });
});

describe('Help & documentation', () => {
  it('has unique, linkable articles', () => {
    expect(new Set(HELP_ARTICLES.map((article) => article.slug)).size).toBe(HELP_ARTICLES.length);
  });

  it('finds an article by what it says, not only by its title', () => {
    expect(searchHelp('invitations').map((article) => article.slug)).toContain('team-and-permissions');
    expect(searchHelp('currency')[0].slug).toBe('finance');
    expect(searchHelp('zzzzzz')).toEqual([]);
  });
});
