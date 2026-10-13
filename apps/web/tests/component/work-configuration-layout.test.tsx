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
    expect(screen.getByText(/can view this configuration but not change it/)).toBeTruthy();
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
    render(<WorkConfiguration {...props({ initialTab: 'workflow' })} />);
    expect(screen.getByText('No stages yet. Add the stage new work starts in.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add status' })).toBeTruthy();
  });
});
