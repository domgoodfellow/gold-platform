// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderConnectionsControl } from '@/features/integrations/connections/header-connections';
import { NavigationActivityContext } from '@/components/navigation/activity-context';
import type { HeaderConnectionAccount, HeaderConnections } from '@/lib/application/shell/connection-menu-model';

const api = vi.hoisted(() => ({ refresh: vi.fn(), router: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/settings/connections/actions', () => ({ headerConnectionsAction: api.refresh }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: api.router }) }));
const base = '/organizations/tenant/settings/connections';
const account = (id: string, key: string, label: string, workspaces: string[], status: HeaderConnectionAccount['status'] = 'active'): HeaderConnectionAccount => ({ id, connectorKey: key, connectorName: key === 'google_workspace' ? 'Google Workspace' : 'Microsoft 365', logoUrl: null, accountLabel: label, status, workspaces, manageHref: `${base}/${id}`, reconnectHref: null, reconnectsExternally: false });
const fixture = (): HeaderConnections => ({ state: 'ready', manageHref: base, accounts: [account('m', 'microsoft_365', 'Operations', ['communications']), account('g', 'google_workspace', 'Sales', ['communications', 'crm'], 'needs_attention')] });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.refresh.mockResolvedValue(fixture());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shared Connect control', () => {
  it('names the health warning, groups relevant accounts first and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<HeaderConnectionsControl organizationId="tenant" initial={fixture()} workspace={{ key: 'crm', label: 'CRM' }} />);
    const trigger = screen.getByRole('button', { name: 'Connect. 1 account needs attention.' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(await screen.findByRole('heading', { name: 'Relevant to CRM' })).toBeVisible();
    const links = screen.getAllByRole('link');
    expect(links.findIndex(link => link.textContent?.includes('Sales'))).toBeLessThan(links.findIndex(link => link.textContent?.includes('Operations')));
    expect(screen.getByText('Needs attention', { exact: true })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse apps' })).toHaveAttribute('href', `${base}?catalog=open&workspace=crm#app-library`);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(api.refresh).toHaveBeenCalledWith('tenant', true);
  });
  it('opens external reconnection in a new tab while an organization call is retained', async () => {
    const data = fixture();
    data.accounts[1] = { ...data.accounts[1], reconnectHref: `${base}/connect/google_workspace?connection=g`, reconnectsExternally: true };
    api.refresh.mockResolvedValue(data);
    render(<NavigationActivityContext.Provider value><HeaderConnectionsControl organizationId="tenant" initial={data} /></NavigationActivityContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    const reconnect = await screen.findByRole('link', { name: 'Reconnect Sales (opens in a new tab)' });
    expect(reconnect).toHaveAttribute('target', '_blank');
    expect(reconnect).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('uses the current workspace without creating a second connection collection', async () => {
    const app = render(<HeaderConnectionsControl organizationId="tenant" initial={fixture()} workspace={{ key: 'crm', label: 'CRM' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    await screen.findByRole('heading', { name: 'Relevant to CRM' });
    app.rerender(<HeaderConnectionsControl organizationId="tenant" initial={fixture()} workspace={{ key: 'communications', label: 'Communications' }} />);
    const relevant = screen.getByRole('heading', { name: 'Relevant to Communications' }).parentElement!;
    expect(within(relevant).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Other accounts' })).not.toBeInTheDocument();
  });
  it('does not call an unavailable read empty and lets the member retry', async () => {
    api.refresh.mockRejectedValueOnce(new Error('network failure'));
    render(<HeaderConnectionsControl organizationId="tenant" initial={{ state: 'unavailable', accounts: [], manageHref: base }} />);
    fireEvent.click(screen.getByRole('button', { name: /Connection status unavailable/ }));
    expect(await screen.findByText('Connection status is unavailable.')).toBeVisible();
    expect(screen.queryByText('No connected accounts.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sales')).toBeVisible();
  });
  it('removes account details and management links if access changes while the shell is open', async () => {
    api.refresh.mockResolvedValueOnce(null);
    render(<HeaderConnectionsControl organizationId="tenant" initial={fixture()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    expect(await screen.findByText('Your access to Connections has changed.')).toBeVisible();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh page' }));
    expect(api.router).toHaveBeenCalled();
  });
  it('reads stored health on window focus without invoking provider verification or API readiness', async () => {
    render(<HeaderConnectionsControl organizationId="tenant" initial={fixture()} />);
    await act(async () => { fireEvent(window, new Event('focus')); });
    expect(api.refresh).toHaveBeenCalledWith('tenant', false);
  });
});
