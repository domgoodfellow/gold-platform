// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Work Dashboard → the one missing step. A type with no stages is made ready on the Dashboard with
 * the same choice Work items and New work give, never by a link to settings; someone who may not
 * configure Work sees what is missing and no control.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const config = vi.hoisted(() => ({
  addStarterStagesAction: vi.fn(async () => ({ error: null as string | null })),
  createStatusAction: vi.fn(async () => ({ error: null as string | null })),
}));
vi.mock('@/features/work/configuration/actions', () => config);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GettingStarted } from '@/features/work/home/work-home';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const step = { kind: 'no-starting-stage' as const, typeId: 't1', typeName: 'Site survey' };

describe('the Work Dashboard’s missing starting stage', () => {
  it('offers the starter stages and a named stage in place, through the Work type actions', async () => {
    render(<GettingStarted organizationId="org" step={step} capabilities={['field.manage']} />);
    expect(screen.getByRole('heading', { name: 'Site survey needs a starting stage' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /starting stage/ })).toBeNull();
    expect(screen.getByRole('form', { name: 'Add a starting stage to Site survey' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Add Booked, In progress and Done' }));
    expect(config.addStarterStagesAction).toHaveBeenCalledTimes(1);
    const sent = (config.addStarterStagesAction.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(Object.fromEntries(sent)).toEqual({ organizationId: 'org', typeId: 't1' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows someone who may not configure Work what is missing, with no control', () => {
    render(<GettingStarted organizationId="org" step={step} capabilities={['work_item.create']} />);
    expect(screen.getByRole('heading', { name: 'Site survey needs a starting stage' })).toBeTruthy();
    expect(screen.getByText('Someone who manages Work adds the starting stage.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the other steps’ actions', () => {
    render(<GettingStarted organizationId="org" step={{ kind: 'no-types' }} capabilities={['field.manage']} />);
    expect(screen.getByRole('link', { name: 'Set up work types' })).toHaveAttribute('href', '/organizations/org/work/configuration');
  });
});
