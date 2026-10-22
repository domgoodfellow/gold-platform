// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkCreatePage } from '@/features/work/work-create-page';
import type { WorkCreateOptions } from '@/lib/application/work/create-options';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/app/organizations/[organizationId]/work/actions', () => ({ createWorkItemAction: vi.fn(async () => ({ error: null })) }));

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

const type = (id: string, name: string) => ({ id, name }) as WorkCreateOptions['types'][number];
const stage = (id: string, name: string) => ({ id, name }) as WorkCreateOptions['statusesByType'][string][number];
const options = (over: Partial<WorkCreateOptions> = {}): WorkCreateOptions => ({
  organizationId: 'org', types: [type('t1', 'Install'), type('t2', 'Repair'), type('t3', 'Survey')],
  statusesByType: { t1: [stage('s1', 'Booked')], t2: [stage('s2', 'Diagnosing'), stage('s3', 'Fixing')], t3: [] },
  customers: [], locations: [], resources: [], assets: [], definitions: [], assetsEnabled: false, ...over,
});
const open = async (ui: React.ReactElement) => { const user = userEvent.setup(); render(ui); return user; };

describe('New work page', () => {
  it('offers every type, starts on the given one, and shows only that type’s stages', async () => {
    const user = await open(<WorkCreatePage options={options()} mayConfigure={false} initialTypeId="t2" />);
    const dialog = screen.getByRole('region', { name: 'New work' });
    const typeSelect = within(dialog).getByLabelText('Work type') as HTMLSelectElement;
    expect([...typeSelect.options].map(o => o.text)).toEqual(['Install', 'Repair', 'Survey']);
    expect(typeSelect.value).toBe('t2');
    const stages = () => [...(within(dialog).getByLabelText('Starting stage') as HTMLSelectElement).options].map(o => o.text);
    expect(stages()).toEqual(['Diagnosing', 'Fixing']);
    await user.selectOptions(typeSelect, 't1');
    expect(stages()).toEqual(['Booked']);
  });

  it('explains a type with no stages and offers configuration only when permitted', async () => {
    const user = await open(<WorkCreatePage options={options()} mayConfigure={false} initialTypeId="t3" />);
    expect(screen.getByText(/A starting stage is required/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Create work type|Configure stages/ })).toBeNull();
    expect(screen.queryByLabelText('Starting stage')).toBeNull();
    void user;
  });

  it('links to work configuration for people who may configure', async () => {
    await open(<WorkCreatePage options={options()} mayConfigure initialTypeId="t3" />);
    expect(screen.getByRole('link', { name: 'Configure stages' })).toHaveAttribute('href', '/organizations/org/work/configuration?type=t3&tab=workflow&returnTo=create');
  });

  it('handles zero types with and without permission', async () => {
    const none = options({ types: [], statusesByType: {} });
    await open(<WorkCreatePage options={none} mayConfigure={false} />);
    expect(screen.queryByRole('link', { name: 'Create work type' })).toBeNull();
    cleanup();
    await open(<WorkCreatePage options={none} mayConfigure />);
    expect(screen.getByRole('link', { name: 'Create work type' })).toHaveAttribute('href', '/organizations/org/work/configuration?new=1&returnTo=create');
  });
});
