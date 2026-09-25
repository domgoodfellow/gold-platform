import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from '@/components/display/brand-mark';
import { ConnectorIcon, isBuiltInConnector } from '@/features/integrations/catalogue/connector-icon';
import { ConnectorAppIcon } from '@/features/integrations/catalogue/connector-app-icons';
import { GENERATED_APP_MARKS, GENERATED_MARKS } from '@/features/platform/brand/marks.generated';
import { ProviderIcon } from '@/features/platform/providers/provider-icon';

/**
 * Brand identity (sections 24-26, 39, 55-56) and the four-noun boundary (section 1, 54) as source
 * guards and rendered-markup checks — never a test against a real MapLibre instance or a literal
 * SVG path, per the prompt's own instruction.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('BrandMark is domain-agnostic', () => {
  it('names no vendor, and knows nothing beyond a label, a colour, an image and an icon', () => {
    const source = read('components/display/brand-mark.tsx');
    for (const vendor of ['google', 'openai', 'anthropic', 'twilio', 'resend', 'slack', 'notion', 'hubspot']) {
      expect(source.toLowerCase(), vendor).not.toContain(vendor);
    }
  });

  it('renders an uploaded image at the highest precedence', () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { label: 'Acme', src: 'https://cdn.example.test/logo.png' }));
    expect(html).toContain('<img');
    expect(html).toContain('logo.png');
  });

  it('falls back to a monogram letter with no image and no icon', () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { label: 'Notion' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('>N<');
  });
});

describe('ConnectorIcon: a built-in mark is authoritative, an upload only ever matters for a connector with no built-in identity', () => {
  const google = { key: 'google_workspace', name: 'Google Workspace' };
  const custom = { key: 'some_private_erp', name: 'Custom ERP' };
  const unknown = { key: 'not_a_real_connector', name: 'Mystery App' };

  it('a built-in connector renders its canonical mark even with a stale uploaded logoUrl on file', () => {
    const html = renderToStaticMarkup(createElement(ConnectorIcon, { connector: google, logoUrl: 'https://cdn.example.test/old-g.png' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
    expect(html).not.toContain('>G<');
  });

  it('a custom/private connector with no built-in identity still renders its uploaded logo', () => {
    const html = renderToStaticMarkup(createElement(ConnectorIcon, { connector: custom, logoUrl: 'https://cdn.example.test/erp.png' }));
    expect(html).toContain('<img');
    expect(html).toContain('erp.png');
  });

  it('a known connector gets its curated real mark with no upload', () => {
    const html = renderToStaticMarkup(createElement(ConnectorIcon, { connector: google, logoUrl: null }));
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
    expect(html).not.toContain('>G<');
  });

  it('an uncatalogued connector key falls back to the generic tile, never a broken image', () => {
    const html = renderToStaticMarkup(createElement(ConnectorIcon, { connector: unknown, logoUrl: null }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('undefined');
  });

  it('never hotlinks a vendor logo — no literal external host in the source', () => {
    for (const file of [
      'features/integrations/catalogue/connector-icon.tsx',
      'features/platform/providers/provider-icon.tsx',
      'features/integrations/catalogue/connector-app-icons.tsx',
      'features/platform/brand/marks.generated.ts',
    ]) {
      expect(read(file), file).not.toMatch(/https?:\/\//);
    }
  });

  it('isBuiltInConnector is true for a curated key and false for an uncatalogued one', () => {
    expect(isBuiltInConnector('google_workspace')).toBe(true);
    expect(isBuiltInConnector('quickbooks')).toBe(true);
    expect(isBuiltInConnector('not_a_real_connector')).toBe(false);
  });
});

describe('ConnectorAppIcon: resolved by connectorKey + appKey together, never by appKey alone', () => {
  it('renders something for a known app, a parent-connector fallback, and a fully unknown one — never a broken image', () => {
    const known = renderToStaticMarkup(createElement(ConnectorAppIcon, { connectorKey: 'google_workspace', appKey: 'gmail', label: 'Gmail' }));
    const parentOnly = renderToStaticMarkup(createElement(ConnectorAppIcon, { connectorKey: 'microsoft_365', appKey: 'outlook', label: 'Outlook' }));
    const unknown = renderToStaticMarkup(createElement(ConnectorAppIcon, { appKey: 'not_a_real_app', label: 'Mystery' }));
    for (const html of [known, parentOnly, unknown]) expect(html).not.toContain('<img');
    expect(known).toContain('<svg');
    // No mark of its own (outlook has none in either source package), but still the suite's real
    // identity rather than a puzzle piece.
    expect(parentOnly).toContain('<svg');
  });

  it('two suites seeding the same app key resolve to two different identities, not one stolen from the other', () => {
    // Both platform_connector_apps rows are real (20260929000003_the_connector_editor_and_support_view.sql
    // seeds a `calendar` app for both google_workspace and microsoft_365) — this is the collision
    // a flat appKey-only lookup would get wrong, proven directly rather than by inspecting source.
    const googleCalendar = GENERATED_APP_MARKS['google_workspace:calendar'];
    expect(googleCalendar, 'expected a curated google_workspace:calendar mark').toBeTruthy();

    const googleHtml = renderToStaticMarkup(
      createElement(ConnectorAppIcon, { connectorKey: 'google_workspace', appKey: 'calendar', label: 'Calendar' }),
    );
    const microsoftHtml = renderToStaticMarkup(
      createElement(ConnectorAppIcon, { connectorKey: 'microsoft_365', appKey: 'calendar', label: 'Calendar' }),
    );

    // Google's own calendar mark renders for the Google Workspace app...
    expect(googleHtml).toContain(googleCalendar.body);
    // ...and Microsoft 365's calendar app never renders Google's mark — it has none of its own
    // curated (checked directly), so it falls back to the microsoft_365 parent mark instead.
    expect(microsoftHtml).not.toContain(googleCalendar.body);
    expect(GENERATED_APP_MARKS['microsoft_365:calendar']).toBeUndefined();
    expect(microsoftHtml).toContain(GENERATED_MARKS.microsoft_365.body);
  });
});

describe('ProviderIcon is distinct from ConnectorIcon (section 1, 56)', () => {
  it('resolves a known Provider key to its real mark', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, { providerKey: 'anthropic', label: 'Anthropic' }));
    expect(html).toContain('<svg');
    expect(html).not.toContain('>A<');
  });

  it('falls back safely for an unknown Provider key', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, { providerKey: 'not_a_real_provider', label: 'Mystery' }));
    expect(html).not.toContain('undefined');
  });

  it('no Platform Provider screen renders ConnectorCard', () => {
    for (const file of [
      'app/organizations/[organizationId]/platform/providers/page.tsx',
      'app/organizations/[organizationId]/platform/providers/[providerKey]/page.tsx',
      'features/platform/providers/provider-detail.tsx',
    ]) {
      expect(read(file), file).not.toContain('ConnectorCard');
    }
  });

  it('no tenant Integrations screen renders ProviderIcon or a Provider-only service', () => {
    const catalogue = read('features/integrations/catalogue/connector-catalogue.tsx');
    const connected = read('features/integrations/connections/connected-apps.tsx');
    for (const source of [catalogue, connected]) {
      expect(source).not.toContain('ProviderIcon');
      expect(source).not.toContain('listProviderServices');
    }
    const page = read('app/organizations/[organizationId]/integrations/page.tsx');
    expect(page).not.toContain('listProviderServices');
    for (const providerOnly of ['Google Routes', 'OpenAI Responses', 'Gemini Interactions']) {
      expect(page, providerOnly).not.toContain(providerOnly);
    }
  });
});

describe('built-in identity has no upload control; a custom connector still can', () => {
  it('the connector editor never renders LogoForm inside the isBuiltInConnector branch, and does render it outside it', () => {
    const source = read('app/organizations/[organizationId]/platform/integrations/[connectorKey]/page.tsx');
    const conditional = source.indexOf('isBuiltInConnector(connector.key) ? (');
    expect(conditional, 'expected a real ternary on isBuiltInConnector(connector.key)').toBeGreaterThan(-1);

    // The built-in branch runs from the `? (` to its matching `) : (` — short enough that a fixed
    // slice comfortably covers it without needing a bracket-matcher.
    const builtInBranch = source.slice(conditional, conditional + 300);
    expect(builtInBranch).not.toContain('<LogoForm');
    expect(builtInBranch).toContain('Built-in connector');

    expect((source.match(/<LogoForm/g) ?? []).length).toBeGreaterThan(0);
  });
});

describe('the four external nouns stay apart in the UI layer (section 54, restated for presentation)', () => {
  it('ConnectorIcon never imports the provider-service domain module', () => {
    const source = read('features/integrations/catalogue/connector-icon.tsx');
    expect(source).not.toContain('lib/domain/providers/services');
  });

  it('ProviderIcon never imports the connector domain module', () => {
    const source = read('features/platform/providers/provider-icon.tsx');
    expect(source).not.toContain('lib/domain/integrations/connectors');
  });
});

describe('the MapLibre / Google Maps Provider Service boundary is untouched by this slice (section 8, 46, 60)', () => {
  it('mapConfig() carries no coupling to Google Provider Services', () => {
    const config = read('lib/adapters/maps/config.ts');
    expect(config).not.toMatch(/google|provider_service|platform_provider_services/i);
  });

  it('LocationMap still renders no Google route/place geometry, and the renderer stays maplibre-gl alone', () => {
    const mapModule = read('features/locations/map/location-map.tsx');
    expect(mapModule).toContain("from 'maplibre-gl'");
    expect(mapModule).not.toMatch(/google\.maps|@googlemaps|route.*polyline/i);

    const packageJson = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    const mapLibs = Object.keys(packageJson.dependencies).filter((name) => /maplibre|mapbox|leaflet|react-map-gl|googlemaps/i.test(name));
    expect(mapLibs).toEqual(['maplibre-gl']);
  });

  it('Google Routes/Route Optimization carry the display-restriction note in their seed, not scattered through UI', () => {
    const migration = read('../../supabase/migrations/20261002000001_the_provider_service_catalogue.sql');
    expect(migration).toContain('map_rendering');
    expect(migration.toLowerCase()).toContain('display/attribution restrictions');

    for (const uiFile of [
      'features/platform/providers/provider-detail.tsx',
      'features/integrations/catalogue/connector-catalogue.tsx',
    ]) {
      expect(read(uiFile), uiFile).not.toMatch(/attribution|display restriction/i);
    }
  });
});

describe('ChatGPT/GPT distribution direction stays out of the component layer too (section 16, 59)', () => {
  it('no component renders a Create GPT / GPT Store control', () => {
    for (const file of [
      'features/platform/providers/provider-detail.tsx',
      'app/organizations/[organizationId]/platform/providers/[providerKey]/page.tsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/create gpt|gpt store|deploy gem/i);
    }
  });
});
