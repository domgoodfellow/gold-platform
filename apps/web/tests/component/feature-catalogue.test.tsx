// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { featureOperationalState } from '@/lib/domain/catalogue/feature-operational-state';

vi.mock('@/app/organizations/[organizationId]/settings/actions', () => ({ setFeatureActivationAction: vi.fn(async () => ({ error: null })) }));
import { FeatureCatalogue, type CatalogueFeature } from '@/features/catalogue/feature-catalogue';
import { EntitlementStatus } from '@/features/catalogue/feature-badges';

const state = (overrides: Partial<ResolvedFeatureState>): ResolvedFeatureState => ({
  featureId: Math.random().toString(36).slice(2), featureKey: 'k', productKey: 'p', implementationState: 'available', entitled: true,
  entitlementSource: 'plan', activation: 'active', readiness: 'ready', ...overrides,
} as ResolvedFeatureState);
const feature = (label: string, product: string, overrides: Partial<ResolvedFeatureState>): CatalogueFeature => ({ id: label, label, description: `${label} description`, product, module: 'Module', state: state(overrides), mayConfigure: true });
const PRICED = 'Nothing is priced yet, so a job cannot be quoted.';
const features: CatalogueFeature[] = [
  feature('Price book', 'Finance', { readiness: 'setup_required', reason: PRICED, primaryHref: '/x' }),
  feature('Quote creation', 'Sales', { readiness: 'setup_required', reason: PRICED, primaryHref: '/x' }),
  feature('Dispatch board', 'Field', { readiness: 'setup_required', reason: 'No resources yet.', primaryHref: '/x' }),
  feature('Assets', 'Field', {}),
  feature('Card payments', 'Finance', { entitled: false, entitlementSource: 'none', readiness: 'unavailable' }),
  feature('Voice agent', 'Finance', { implementationState: 'planned', readiness: 'unavailable', entitled: false }),
  // A legacy module grant can entitle a partly built feature; it is still not usable.
  feature('Call recording', 'Communications', { implementationState: 'partial', entitlementSource: 'legacy_module', readiness: 'unavailable' }),
  feature('Paused thing', 'Field', { activation: 'disabled', readiness: 'unavailable' }),
];

afterEach(cleanup);

describe('featureOperationalState', () => {
  it('classifies implementation before entitlement, so planned or partial work is never included or offered', () => {
    expect(features.map((item) => featureOperationalState(item.state))).toEqual([
      'setup_required', 'setup_required', 'setup_required', 'ready', 'not_included', 'unsupported', 'unsupported', 'disabled',
    ]);
  });

  it('is unsupported for every planned or partial combination of entitlement, activation and readiness', () => {
    for (const implementationState of ['planned', 'partial'] as const) {
      for (const entitled of [true, false]) {
        for (const activation of ['active', 'disabled'] as const) {
          for (const readiness of ['ready', 'setup_required', 'unavailable'] as const) {
            expect(featureOperationalState({ implementationState, entitled, activation, readiness })).toBe('unsupported');
          }
        }
      }
    }
  });
});

describe('Settings → Features', () => {
  it('shows only usable features: no planned or partial roadmap entries and no upgrade list', () => {
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    for (const hidden of ['Voice agent', 'Call recording', 'Card payments']) expect(screen.queryByText(hidden)).toBeNull();
    expect(screen.queryByText(/Planned/)).toBeNull();
    expect(screen.queryByText(/Limited availability/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Communications' })).toBeNull();
    for (const shown of ['Price book', 'Quote creation', 'Dispatch board', 'Assets', 'Paused thing']) expect(screen.getByText(shown)).toBeInTheDocument();
  });

  it('points to Plan & usage once for what the plan does not include, and never for unsupported work', () => {
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    expect(screen.getByText('1 more feature is available on other plans.')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'View plan & usage' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/organizations/org/settings/plan');
  });

  it('offers no plan link when everything not usable is merely unsupported', () => {
    render(<FeatureCatalogue organizationId="org" features={features.filter((item) => item.label !== 'Card payments')} mayManage />);
    expect(screen.queryByRole('link', { name: 'View plan & usage' })).toBeNull();
  });

  it('offers no activation action for unsupported work, even when a legacy grant entitles it', () => {
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    expect(screen.queryByRole('button', { name: 'More actions for Call recording' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More actions for Assets' })).toBeInTheDocument();
  });

  it('says a reason shared across products once for the page, and a product-only reason once for that product', () => {
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    expect(screen.getAllByText(PRICED)).toHaveLength(1);
    expect(screen.getByRole('note')).toHaveTextContent('Affects Price book, Quote creation.');
    expect(within(screen.getByRole('region', { name: 'Field' })).getAllByText('No resources yet.')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Set up' })).toHaveLength(3);
  });

  it('searches and filters only operational features', async () => {
    const user = userEvent.setup();
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    expect(screen.getByRole('button', { name: 'All 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Planned/ })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search features' }), 'voice');
    expect(screen.getByText(/No features match/)).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search features' }));
    await user.click(screen.getByRole('button', { name: 'Disabled 1' }));
    expect(screen.getByRole('button', { name: 'Disabled 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Paused thing')).toBeInTheDocument();
    expect(screen.queryByText('Assets')).toBeNull();
  });

  it('keeps management actions for a manager and none for a member who may not manage', () => {
    const { unmount } = render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    expect(screen.getByRole('button', { name: 'More actions for Assets' })).toBeInTheDocument();
    unmount();
    render(<FeatureCatalogue organizationId="org" features={features} mayManage={false} />);
    expect(screen.queryByRole('button', { name: /^More actions for / })).toBeNull();
    expect(screen.getByText(/cannot switch features on or off/)).toBeInTheDocument();
  });
});

describe('Platform entitlement badge', () => {
  it('reads the same classification, and leaves planned or partial to the implementation badge', () => {
    const badge = (label: string) => {
      const { container, unmount } = render(<EntitlementStatus state={features.find((item) => item.label === label)!.state} />);
      const text = container.textContent;
      unmount();
      return text;
    };
    expect(badge('Assets')).toBe('Included · On');
    expect(badge('Price book')).toBe('Included · On');
    expect(badge('Paused thing')).toBe('Included · Off');
    expect(badge('Card payments')).toBe('Not included');
    expect(badge('Call recording')).toBe('');
    expect(badge('Voice agent')).toBe('');
  });
});
