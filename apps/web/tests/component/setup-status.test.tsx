// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from '@/lib/application/setup/status';
import { showsSetupStatus } from '@/lib/shell';

/**
 * The organization header's setup status, driven as a person would: a compact trigger whose name
 * carries the state, a popover that opens only when chosen, reads the overview again, lists what
 * still blocks launch and links to the Setup page. Escape closes it and returns focus to the trigger.
 */
const action = vi.fn<(organizationId: string) => Promise<SetupStatus>>();
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock('@/app/organizations/[organizationId]/setup/status-actions', () => ({ setupStatusAction: (organizationId: string) => action(organizationId) }));
const { SetupStatusControl } = await import('@/features/setup/setup-status');

const ORG = 'org-1';
const SETUP = `/organizations/${ORG}/setup`;
const open = (required: number, mayLaunch = true, ready = 2, total = 6): SetupStatus => ({
  state: 'open', mayLaunch, ready, total,
  required: Array.from({ length: required }, (_, index) => ({ key: `area-${index}`, label: `Area ${index}`, message: `Area ${index} needs setup.` })),
});

beforeEach(() => { action.mockReset(); });
afterEach(cleanup);

describe('organization setup status in the header', () => {
  it('names the remaining required steps on the trigger and lists them, with the review link, when opened', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue(open(2));
    render(<SetupStatusControl organizationId={ORG} initial={open(2)} />);
    const trigger = screen.getByRole('button', { name: 'Setup. 2 required steps remain.' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('dialog', { name: 'Setup' });
    expect(within(panel).getByText('2 required steps remain')).toBeInTheDocument();
    expect(within(panel).getByRole('progressbar', { name: '2 of 6 setup areas ready' })).toBeInTheDocument();
    expect(within(panel).getByText('2 of 6 setup areas ready, optional ones included')).toBeInTheDocument();
    const steps = within(panel).getByRole('list', { name: 'Required before launch' });
    expect(within(steps).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Area 0Area 0 needs setup.', 'Area 1Area 1 needs setup.']);
    expect(within(panel).getByRole('link', { name: 'Review setup' })).toHaveAttribute('href', SETUP);
    expect(action).toHaveBeenCalledWith(ORG);
  });

  it('uses the singular for one remaining step', () => {
    render(<SetupStatusControl organizationId={ORG} initial={open(1)} />);
    expect(screen.getByRole('button', { name: 'Setup. 1 required step remains.' })).toBeInTheDocument();
  });

  it('reads the overview again on opening, so a step finished elsewhere is reflected', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue(open(0, true, 6, 6));
    render(<SetupStatusControl organizationId={ORG} initial={open(2)} />);
    await user.click(screen.getByRole('button', { name: 'Setup. 2 required steps remain.' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Setup. Ready to launch.' })).toBeInTheDocument());
    const panel = screen.getByRole('dialog', { name: 'Setup' });
    expect(within(panel).getByText('Required setup is complete')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Review and launch' })).toHaveAttribute('href', SETUP);
  });

  it('shows someone who cannot launch the same facts, with no instruction to act and no launch wording', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue(open(2, false));
    render(<SetupStatusControl organizationId={ORG} initial={open(2, false)} />);
    await user.click(screen.getByRole('button', { name: 'Setup. 2 required steps remain.' }));
    const panel = screen.getByRole('dialog', { name: 'Setup' });
    expect(within(panel).getByText('An organization manager can finish setup.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'View setup' })).toHaveAttribute('href', SETUP);
    expect(within(panel).queryByRole('link', { name: /launch/i })).not.toBeInTheDocument();
  });

  it('tells someone who cannot launch that the business is ready, without a launch action', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue(open(0, false, 6, 6));
    render(<SetupStatusControl organizationId={ORG} initial={open(0, false, 6, 6)} />);
    await user.click(screen.getByRole('button', { name: 'Setup. Ready to launch.' }));
    const panel = screen.getByRole('dialog', { name: 'Setup' });
    expect(within(panel).getByText('An organization manager can launch this business.')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: 'Review and launch' })).not.toBeInTheDocument();
  });

  it('says so plainly when the status cannot be read, and can try again', async () => {
    const user = userEvent.setup();
    action.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(open(1));
    render(<SetupStatusControl organizationId={ORG} initial={{ state: 'unavailable', mayLaunch: true }} />);
    await user.click(screen.getByRole('button', { name: 'Setup. Status unavailable.' }));
    const panel = screen.getByRole('dialog', { name: 'Setup' });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Try again' })).toBeEnabled());
    expect(within(panel).getByText('Setup status is unavailable.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Review setup' })).toHaveAttribute('href', SETUP);
    await user.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Setup. 1 required step remains.' })).toBeInTheDocument());
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue(open(2));
    render(<SetupStatusControl organizationId={ORG} initial={open(2)} />);
    const trigger = screen.getByRole('button', { name: 'Setup. 2 required steps remain.' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Setup' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('disappears once the business has launched', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ state: 'live' });
    const { container } = render(<SetupStatusControl organizationId={ORG} initial={open(0)} />);
    await user.click(screen.getByRole('button', { name: 'Setup. Ready to launch.' }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    cleanup();
    expect(render(<SetupStatusControl organizationId={ORG} initial={{ state: 'live' }} />).container).toBeEmptyDOMElement();
  });
});

describe('where the setup status is shown', () => {
  it('belongs to this business’s own pages only', () => {
    expect(showsSetupStatus(`/organizations/${ORG}/home`, ORG)).toBe(true);
    expect(showsSetupStatus(`/organizations/${ORG}/settings/branding?x=1`, ORG)).toBe(true);
    expect(showsSetupStatus(`/organizations/${ORG}/crm/contacts/`, ORG)).toBe(true);
  });
  it('is not shown in Platform administration, on the Setup pages, on account pages or for another business', () => {
    expect(showsSetupStatus("/platform", ORG)).toBe(false);
    expect(showsSetupStatus("/platform/organizations", ORG)).toBe(false);
    expect(showsSetupStatus(`/organizations/${ORG}/setup`, ORG)).toBe(false);
    expect(showsSetupStatus(`/organizations/${ORG}/setup/proposal`, ORG)).toBe(false);
    expect(showsSetupStatus('/settings/account', ORG)).toBe(false);
    expect(showsSetupStatus('/organizations/org-2/home', ORG)).toBe(false);
  });
});
