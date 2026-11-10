// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContactImport } from '@/features/crm/intake/contact-import';
import { NavigationActivityContext } from '@/components/navigation/activity-context';
import { chooseOption } from '../support/select-field';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({ load: vi.fn(), sync: vi.fn(), upload: vi.fn(), file: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/library/imports/new/actions', () => ({ contactImportSourcesAction: api.load, importContactWorksheetAction: api.sync, uploadSourceAction: api.upload, selectLibraryFileAction: api.file }));
const sources = {
  accounts: [{ id: 'g', label: 'Sales Google', connector: 'google_workspace', status: 'active' }, { id: 'm', label: 'Office Microsoft', connector: 'microsoft_365', status: 'active' }],
  worksheets: [{ id: 'gs', accountId: 'g', name: 'Google leads', type: 'google_sheet' }, { id: 'ms', accountId: 'm', name: 'Excel leads', type: 'microsoft_workbook' }], saved: [], files: [],
  providers: [{ key: 'google_workspace', name: 'Google Workspace', connectable: true }, { key: 'microsoft_365', name: 'Microsoft 365', connectable: false }],
};
beforeEach(() => { vi.clearAllMocks(); api.load.mockResolvedValue({ sources, error: null }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('limits spreadsheets to the chosen account and submits the exact selected worksheet parameters', async () => {
  api.sync.mockResolvedValue({ error: 'The worksheet is unavailable.' });
  const user = userEvent.setup();
  render(<ContactImport organizationId="org" initialAccountId="m" />);
  await screen.findByRole('combobox', { name: 'Spreadsheet' });
  expect(screen.getByLabelText('Worksheet')).toBeVisible();
  await user.type(screen.getByLabelText('Worksheet'), 'Leads');
  await user.type(screen.getByLabelText('Range'), 'A1:D51');
  await user.type(screen.getByLabelText('Stable ID column'), '2');
  await user.click(screen.getByRole('button', { name: 'Continue to mapping' }));
  await screen.findByText('The worksheet is unavailable.');
  expect(Object.fromEntries(api.sync.mock.calls[0][1])).toMatchObject({ organizationId: 'org', resourceId: 'ms', worksheet: 'Leads', range: 'A1:D51', key_column: '2' });
  await chooseOption(screen.getByRole('combobox', { name: 'Account' }), 'Sales Google · Connected');
  expect(screen.queryByLabelText('Worksheet')).not.toBeInTheDocument();
});
it('offers only ready sign-in routes and preserves the original call during authorization', async () => {
  render(<NavigationActivityContext.Provider value><ContactImport organizationId="org" /></NavigationActivityContext.Provider>);
  const link = await screen.findByRole('link', { name: 'Connect Google Workspace (opens in a new tab)' });
  expect(link).toHaveAttribute('href', '/organizations/org/settings/connections/connect/google_workspace?intent=contact-import');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('link', { name: /Connect Microsoft/ })).not.toBeInTheDocument();
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
});
it('keeps failed loading distinct from an empty account list and offers a retry', async () => {
  api.load.mockResolvedValueOnce({ sources: null, error: 'Your role cannot import contacts.' });
  render(<ContactImport organizationId="org" />);
  await screen.findByText('Your role cannot import contacts.');
  expect(screen.queryByText('Connect an account to choose a spreadsheet.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('combobox', { name: 'Account' })).toBeVisible();
});
