// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';

vi.mock('@/app/organizations/[organizationId]/settings/actions', () => ({ setFeatureActivationAction: vi.fn(async () => ({ error: null })) }));
import { FeatureCatalogue, featureStatus, type CatalogueFeature } from '@/features/catalogue/feature-catalogue';

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
  feature('Paused thing', 'Field', { activation: 'disabled', readiness: 'unavailable' }),
];

afterEach(cleanup);

describe('Feature status', () => {
  it('classifies planned before entitlement, so a planned feature is never "not in your plan"', () => {
    expect(features.map((item) => featureStatus(item.state))).toEqual(['setup', 'setup', 'setup', 'included', 'not-included', 'planned', 'disabled']);
  });
});

describe('Settings → Features catalogue', () => {
  it('folds what is not in the plan and what is planned, with one plan link and no plan offer for planned work', async () => {
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    const finance = screen.getByRole('region', { name: 'Finance' });
    const notInPlan = within(finance).getByText('Not in your plan (1)').closest('details')!;
    const planned = within(finance).getByText('Planned (1)').closest('details')!;
    expect(notInPlan).not.toHaveAttribute('open');
    expect(planned).not.toHaveAttribute('open');
    expect(within(notInPlan).getAllByRole('link', { name: 'View plan' })).toHaveLength(1);
    expect(within(planned).queryByRole('link', { name: 'View plan' })).toBeNull();
    expect(within(planned).getByText(/not available yet, on any plan/)).toBeInTheDocument();
  });

  it('says a reason shared across products once for the page, and a product-only reason once for that product', () => {
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    expect(screen.getAllByText(PRICED)).toHaveLength(1);
    expect(screen.getByRole('note')).toHaveTextContent('Affects Price book, Quote creation.');
    expect(within(screen.getByRole('region', { name: 'Field' })).getAllByText('No resources yet.')).toHaveLength(1);
    // Rows keep their own Set up action.
    expect(screen.getAllByRole('link', { name: 'Set up' })).toHaveLength(3);
  });

  it('searches every feature, opening folded groups, and filters in place by status', async () => {
    const user = userEvent.setup();
    render(<FeatureCatalogue organizationId="org" features={features} mayManage />);
    await user.type(screen.getByRole('searchbox', { name: 'Search features' }), 'voice');
    const planned = screen.getByText('Planned (1)').closest('details')!;
    expect(planned).toHaveAttribute('open');
    expect(screen.queryByRole('region', { name: 'Field' })).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search features' }));
    await user.click(screen.getByRole('button', { name: 'Disabled 1' }));
    expect(screen.getByRole('button', { name: 'Disabled 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Paused thing')).toBeInTheDocument();
    expect(screen.queryByText('Assets')).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search features' }), 'nothing like this');
    expect(screen.getByText(/No features match/)).toBeInTheDocument();
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
