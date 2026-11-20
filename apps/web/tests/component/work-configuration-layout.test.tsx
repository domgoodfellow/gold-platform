// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkConfiguration, type WorkConfigurationData } from '@/features/work/configuration/work-configuration';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/work/configuration/actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return {
    addTypeChecklistItemAction: action,
    createStatusAction: action,
    createTransitionAction: action,
    createTypeAction: action,
    removeTypeChecklistItemAction: action,
    renameTypeAction: action,
    setTypeBookableAction: action,
    setTypeBookingIntakeAction: action,
    setTypeBookingPolicyAction: action,
    setTypeSchedulableAction: action,
    updateStatusAction: action,
    addStarterStagesAction: action,
    createResourceRequirementAction: action,
    deleteResourceRequirementAction: action,
    updateResourceRequirementAction: action,
  };
});
vi.mock('@/components/panels/page-drawer', () => ({
  PageDrawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageDrawerContent: ({ children }: { children: React.ReactNode }) => <div role="dialog" aria-label="New work type">{children}</div>,
  PageDrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('@/features/custom-fields/configuration/entity-fields-configuration', () => ({ EntityFieldsConfiguration: () => <div>fields</div> }));
vi.mock('@/app/organizations/[organizationId]/finance/catalog/expected-cost-actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return { addItemExpectedCostAction: action, removeItemExpectedCostAction: action, setStageExpectedCostAction: action };
});
vi.mock('@/app/organizations/[organizationId]/finance/configuration/pricing/actions', () => ({ setDeliveryTypeAction: vi.fn(async () => ({ error: null })) }));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const type = (id: string, name: string, schedulable: boolean) => ({ id, name, schedulable });
const props = (over: Partial<WorkConfigurationData> = {}): WorkConfigurationData => ({
  organizationId: 'org',
  role: 'staff',
  mayConfigure: true,
  types: [type('t1', 'Install', true), type('t2', 'Quote', false)],
  selectedType: type('t1', 'Install', true),
  statuses: [],
  transitions: [],
  templateSteps: [],
  fieldDefinitions: [],
  prices: [],
  booking: null,
  bookingEnabled: false,
  requirements: [],
  capabilities: [],
  intakeForms: [],
  typeHref: (id) => `/c?type=${id}`,
  ...over,
});

describe('Work configuration layout', () => {
  it('lists the types as links, marks the selected one, and keeps creation out of the type’s own settings', () => {
    render(<WorkConfiguration {...props()} />);
    const list = screen.getByRole('navigation', { name: 'Work types' });
    expect(within(list).getByRole('link', { name: /Install/ })).toHaveAttribute('aria-current', 'page');
    expect(within(list).getByRole('link', { name: /Quote/ })).toHaveAttribute('href', '/c?type=t2');
    expect(screen.getAllByRole('button', { name: 'New type' })).toHaveLength(1);
    // Editing Install never shows the create form: that lives in the New type drawer.
    expect(within(screen.getByRole('tabpanel')).queryByRole('radio', { name: /^Scheduled/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Install' })).toBeTruthy();
  });

  it('offers no creation to someone who may not configure', () => {
    render(<WorkConfiguration {...props({ mayConfigure: false })} />);
    expect(screen.queryByRole('button', { name: 'New type' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.getByText(/View only/)).toBeTruthy();
  });

  it('shows Requirements only for scheduled work, and treats the earlier ?tab=types as General', () => {
    const { rerender } = render(<WorkConfiguration {...props({ initialTab: 'types' })} />);
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Requirements' })).toBeTruthy();
    rerender(<WorkConfiguration {...props({ selectedType: type('t2', 'Quote', false), initialTab: 'requirements' })} />);
    expect(screen.queryByRole('tab', { name: 'Requirements' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  });

  it('offers creation when there are no types', () => {
    render(<WorkConfiguration {...props({ types: [], selectedType: null })} />);
    expect(screen.getByText('No work types yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New type' })).toBeTruthy();
  });

  it('points a type with no stages at the Workflow tab’s first step', () => {
    render(<WorkConfiguration {...props()} />);
    expect(screen.getByRole('tab', { name: 'Workflow' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add Booked, In progress and Done' })).toBeTruthy();
    expect(screen.getByLabelText('Or name the starting stage')).toBeTruthy();
    // A heading, not an uppercase label above the stages.
    expect(screen.getByRole('heading', { name: 'Stages' }).className).not.toMatch(/uppercase/);
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
  });

  it('preserves explicit General and identifies the independently saved operations', () => {
    render(<WorkConfiguration {...props({ initialTab: 'general' })} />);
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save scheduling behavior' })).toBeVisible();
  });
});

describe('fields and pricing', () => {
  const booked = { id: 's1', name: 'Booked', position: 0, releasesResource: false, marksComplete: false };

  it('keeps Fields, which every work type shares, out of one type’s tabs and opens it on its own', () => {
    const { rerender } = render(<WorkConfiguration {...props({ fieldsHref: '/c?tab=fields' })} />);
    expect(screen.queryByRole('tab', { name: 'Fields' })).toBeNull();
    const all = screen.getByRole('navigation', { name: 'All work' });
    expect(within(all).getByRole('link', { name: /Fields/ })).toHaveAttribute('href', '/c?tab=fields');
    rerender(<WorkConfiguration {...props({ fieldsHref: '/c?tab=fields', fieldsOpen: true, typeRequested: false, selectedType: null })} />);
    expect(screen.getByRole('heading', { name: 'Fields' })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'All work' })).getByRole('link', { name: /Fields/ })).toHaveAttribute('aria-current', 'page');
  });

  it('offers Pricing only when the business sells through its catalog, with costs only for cost readers', () => {
    const item = { id: 'i1', name: 'Oil change, workshop', unit: 'job', unitAmountMinor: 8900, currency: 'EUR', createdAt: '', deliveryTypeId: 't1' };
    const stages = [{ ...booked, cost: { statusId: 's1', expectedMinutes: 30, hourlyCostMinor: 6000, currency: 'EUR' } }];
    const pricing = (mayReadCosts: boolean) => ({
      items: [{ item, lines: [], stages, expected: { costMinor: 3000, marginMinor: 5900, itemCostMinor: 0, stageCostMinor: 3000, minutes: 30, issue: null } }],
      stages: mayReadCosts ? stages : [], otherItems: [], currency: 'EUR', mayReadCosts, mayManageCosts: false, mayManagePrices: false,
    });
    render(<WorkConfiguration {...props({ statuses: [booked], initialTab: 'pricing' })} />);
    expect(screen.queryByRole('tab', { name: 'Pricing' })).toBeNull();
    cleanup();
    render(<WorkConfiguration {...props({ statuses: [booked], initialTab: 'pricing', pricing: pricing(true) })} />);
    expect(screen.getByRole('tab', { name: 'Pricing' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Oil change, workshop' })).toHaveAttribute('href', '/organizations/org/finance/catalog/i1');
    expect(screen.getByText(/Expected cost €30\.00 · margin €59\.00 \(66\.3%\)/)).toBeTruthy();
    expect(screen.getByText('Per job: 30 min · €30.00')).toBeTruthy();
    cleanup();
    render(<WorkConfiguration {...props({ statuses: [booked], initialTab: 'pricing', pricing: pricing(false) })} />);
    expect(screen.queryByText(/Expected cost/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Time and cost per stage' })).toBeNull();
  });
});
