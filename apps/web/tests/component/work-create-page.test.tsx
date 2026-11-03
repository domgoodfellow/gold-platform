// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkCreatePage } from '@/features/work/work-create-page';
import type { WorkCreateOptions } from '@/lib/application/work/create-options';
import { chooseOption, fieldValue, optionLabels } from '../support/select-field';
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const config = vi.hoisted(() => ({ createStatusAction: vi.fn(async () => ({ error: null as string | null })), createTypeAction: vi.fn(async () => ({ error: null, createdTypeId: 'new-type' })) }));
vi.mock('@/features/work/configuration/actions', () => config);

vi.mock('@/app/organizations/[organizationId]/work/actions', () => ({ createWorkItemAction: vi.fn(async () => ({ error: null })) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
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
    await open(<WorkCreatePage options={options()} mayConfigure={false} initialTypeId="t2" />);
    const dialog = screen.getByRole('region', { name: 'New work' });
    const typeSelect = within(dialog).getByLabelText('Work type');
    // A type that cannot start work yet says so in the list, so anyone can choose one that is ready.
    expect(await optionLabels(typeSelect)).toEqual(['Install', 'Repair', 'Survey (needs a starting stage)']);
    expect(fieldValue(typeSelect)).toBe('t2');
    const stages = () => optionLabels(within(dialog).getByLabelText('Starting stage'));
    expect(await stages()).toEqual(['Diagnosing', 'Fixing']);
    await chooseOption(typeSelect, 't1');
    expect(await stages()).toEqual(['Booked']);
  });

  it('explains a type with no stages, offers ready types and no configuration when not permitted', async () => {
    await open(<WorkCreatePage options={options()} mayConfigure={false} initialTypeId="t3" />);
    expect(screen.getByText(/A starting stage is required/)).toBeInTheDocument();
    expect(screen.getByText(/An administrator must configure the type/)).toBeInTheDocument();
    expect(screen.getByText(/choose a Work type that is ready/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /Add a starting stage/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Work type settings' })).toBeNull();
    expect(screen.queryByLabelText('Starting stage')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create work' })).toBeNull();
  });

  it('lets a configuring member add the starting stage in place, naming nothing for them, then returns to creation', async () => {
    const user = await open(<WorkCreatePage options={options()} mayConfigure initialTypeId="t3" />);
    const form = screen.getByRole('form', { name: 'Add a starting stage to Survey' });
    const name = within(form).getByLabelText('Starting stage name') as HTMLInputElement;
    // No stage is invented: the field starts empty and nothing is written until it is submitted.
    expect(name.value).toBe('');
    expect(config.createStatusAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create work' })).toBeNull();
    await user.type(name, 'Booked in');
    await user.click(within(form).getByRole('button', { name: 'Add stage and continue' }));
    expect(config.createStatusAction).toHaveBeenCalledTimes(1);
    const sent = (config.createStatusAction.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(Object.fromEntries(sent)).toEqual({ organizationId: 'org', typeId: 't3', name: 'Booked in' });
    expect(router.refresh).toHaveBeenCalled();
    // The chosen type survives the refresh that brings its new stage in.
    expect(fieldValue(screen.getByLabelText('Work type'))).toBe('t3');
    expect(screen.getByRole('link', { name: 'Open Work type settings' })).toHaveAttribute('href', '/organizations/org/work/configuration?type=t3&tab=workflow&returnTo=create');
  });

  it('keeps the typed stage name when the stage is refused, and does not move on', async () => {
    config.createStatusAction.mockResolvedValueOnce({ error: 'A status with that name already exists.' });
    const user = await open(<WorkCreatePage options={options()} mayConfigure initialTypeId="t3" />);
    const name = screen.getByLabelText('Starting stage name') as HTMLInputElement;
    await user.type(name, 'Booked');
    await user.click(screen.getByRole('button', { name: 'Add stage and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(name.value).toBe('Booked');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('handles zero types with and without permission', async () => {
    const none = options({ types: [], statusesByType: {} });
    await open(<WorkCreatePage options={none} mayConfigure={false} />);
    expect(screen.getByText('No work types yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create type' })).toBeNull();
    cleanup();
    await open(<WorkCreatePage options={none} mayConfigure />);
    expect(screen.getByRole('button', { name: 'Create type' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Work type settings' })).toHaveAttribute('href', '/organizations/org/work/configuration?new=1&returnTo=create');
  });
});
