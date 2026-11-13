// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddContactsTrigger, ContactIntakeProvider } from '@/features/crm/intake/contact-intake';
import type { ContactIntakeOptions } from '@/lib/application/crm/contact-intake';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { chooseOption, fieldValue } from '../support/select-field';

const customers = vi.hoisted(() => ({ createCustomerAction: vi.fn(), companyOptionsAction: vi.fn(async () => [{ id: 'c-1', name: 'Acme Ltd' }]) }));
vi.mock('@/app/organizations/[organizationId]/crm/contacts/actions', () => customers);
vi.mock('@/app/organizations/[organizationId]/library/imports/new/actions', () => ({ contactImportSourcesAction: vi.fn(async () => ({ sources: { accounts: [], worksheets: [], saved: [], files: [], providers: [] }, error: null })), importContactWorksheetAction: vi.fn(), selectLibraryFileAction: vi.fn(), uploadSourceAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/organizations/org/crm' }));

const ALL: ContactIntakeOptions = {
  manual: { state: 'available' },
  import: { state: 'available', href: '/organizations/org/library/imports/new' },
  sync: { state: 'available', href: '/organizations/org/library/sources', connectHref: '/organizations/org/settings/connections',
    sources: [{ id: 'r-1', name: 'Leads sheet', type: 'Google Sheets worksheet', href: '/organizations/org/library/sources/r-1', connection: 'active' }] },
  mayView: true,
};
const definition = (key: string, label: string): FieldDefinition => ({ id: key, key, label, kind: 'text', entityType: 'customer', required: false, options: [], position: 0, createdAt: '2026-01-01' }) as FieldDefinition;
const confirmation = () => screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' });
const dialog = (name: string) => screen.getByRole('dialog', { name });
function deferred() { let resolve: (value: unknown) => void = () => {}; const promise = new Promise(done => { resolve = done; }); return { promise, resolve: (value: unknown) => act(async () => resolve(value)) }; }
function setup(options = ALL, extra: { definitions?: FieldDefinition[]; defaultOpen?: boolean; initialType?: 'person' | 'company' } = {}) {
  const user = userEvent.setup();
  render(<ContactIntakeProvider organizationId="org" definitions={extra.definitions ?? []} options={options} defaultOpen={extra.defaultOpen} initialType={extra.initialType}>
    <header><AddContactsTrigger /></header><section aria-label="Empty state"><AddContactsTrigger tone="secondary" /></section>
  </ContactIntakeProvider>);
  return user;
}
async function manual(user: ReturnType<typeof userEvent.setup>, type?: 'Person' | 'Company') {
  await user.click(screen.getAllByRole('button', { name: /Add contacts/ })[0]);
  await user.click(within(dialog('Add contacts')).getByRole('button', { name: /Create manually/ }));
  if (type) await user.click(screen.getByRole('radio', { name: new RegExp(type) }));
}

beforeEach(() => { customers.createCustomerAction.mockReset(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Add contacts intake', () => {
  it('opens the same three-way choice from every entry point', async () => {
    const user = setup();
    for (const trigger of screen.getAllByRole('button', { name: /Add contacts/ })) {
      await user.click(trigger);
      const choices = within(dialog('Add contacts')).getByRole('list', { name: 'Ways to add contacts' });
      expect(within(choices).getByRole('button', { name: /Create manually/ })).toBeInTheDocument();
      expect(within(choices).getByRole('button', { name: /Import records/ })).toBeInTheDocument();
      expect(within(choices).getByRole('link', { name: 'Refresh and review' })).toHaveAttribute('href', '/organizations/org/library/sources/r-1');
      expect(within(choices).getByRole('button', { name: 'Choose a spreadsheet' })).toBeInTheDocument();
      expect(within(choices).queryByText(/Google Contacts|Outlook contacts/i)).toBeNull();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  });

  it('explains unavailable paths instead of offering them', async () => {
    const user = setup({ manual: { state: 'unavailable', reason: 'Your role cannot add contacts.' }, import: { state: 'unavailable', reason: 'Importing needs permission to manage data sources.' }, sync: { state: 'unavailable', reason: 'Synchronizing needs permission to manage data sources.', sources: [] }, mayView: true });
    await user.click(screen.getAllByRole('button', { name: /Add contacts/ })[0]);
    const box = dialog('Add contacts');
    expect(within(box).queryByRole('button', { name: /Create manually/ })).toBeNull();
    expect(within(box).queryByRole('link')).toBeNull();
    for (const reason of ['Your role cannot add contacts.', 'Importing needs permission to manage data sources.', 'Synchronizing needs permission to manage data sources.']) expect(within(box).getByText(reason)).toBeInTheDocument();
  });

  it('creates a Person from the essentials alone and offers View contact, Add another and Close', async () => {
    customers.createCustomerAction.mockResolvedValue({ error: null, created: true, id: 'p-1', contactType: 'person', name: 'Ada Marsh' });
    const user = setup();
    await manual(user);
    expect(screen.queryByLabelText('Name')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Person/ }));
    expect(screen.getByLabelText(/^Job title/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Ada Marsh');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('dialog', { name: 'Contact added' });
    const data = customers.createCustomerAction.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({ organizationId: 'org', contactType: 'person', name: 'Ada Marsh', email: '', companyId: '' });
    expect(screen.getByRole('link', { name: 'View contact' })).toHaveAttribute('href', '/organizations/org/crm/contacts/p-1');
    expect(confirmation()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add another' }));
    expect(screen.getByRole('radio', { name: /Person/ })).not.toBeChecked();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('creates a Company with company essentials and its website field when defined', async () => {
    customers.createCustomerAction.mockResolvedValue({ error: null, created: true, id: 'c-9', contactType: 'company', name: 'Northgate' });
    const user = setup(ALL, { definitions: [definition('website', 'Website'), definition('industry', 'Industry')] });
    await manual(user, 'Company');
    expect(screen.queryByLabelText('Job title')).toBeNull();
    expect(screen.getByLabelText(/^General email/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Company name'), 'Northgate');
    await user.type(screen.getByLabelText(/Website/), 'https://northgate.example');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('dialog', { name: 'Contact added' });
    expect(Object.fromEntries(customers.createCustomerAction.mock.calls[0][1] as FormData)).toMatchObject({ contactType: 'company', name: 'Northgate', custom_website: 'https://northgate.example' });
  });

  it('keeps essentials when moving to Additional information and saves the details supplied there', async () => {
    customers.createCustomerAction.mockResolvedValue({ error: null, created: true, id: 'p-2', contactType: 'person', name: 'Ben' });
    const user = setup(ALL, { definitions: [definition('industry', 'Industry')] });
    await manual(user, 'Person');
    await user.type(screen.getByLabelText('Name'), 'Ben');
    await user.click(screen.getByRole('button', { name: 'Add more details' }));
    expect(screen.getByRole('navigation', { name: 'Progress' }).querySelector('[aria-current="step"]')).toHaveTextContent('Additional information');
    await chooseOption(screen.getByLabelText('Lifecycle'), 'customer');
    await user.type(screen.getByLabelText(/Industry/), 'Marine');
    await user.click(screen.getByRole('button', { name: 'Back to essentials' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Ben');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('dialog', { name: 'Contact added' });
    expect(Object.fromEntries(customers.createCustomerAction.mock.calls[0][1] as FormData)).toMatchObject({ name: 'Ben', lifecycle: 'customer', custom_industry: 'Marine' });
  });

  it('creates a company inline and returns to the pending person with every value intact', async () => {
    customers.createCustomerAction.mockResolvedValueOnce({ error: null, created: true, id: 'c-2', contactType: 'company', name: 'Harbour Supply' })
      .mockResolvedValueOnce({ error: null, created: true, id: 'p-3', contactType: 'person', name: 'Cy Lund' });
    const user = setup();
    await manual(user, 'Person');
    await user.type(screen.getByLabelText('Name'), 'Cy Lund');
    await user.type(screen.getByLabelText(/^Email/), 'cy@example.test');
    await user.type(screen.getByLabelText(/^Job title/), 'Buyer');
    await user.click(screen.getByRole('button', { name: 'New company' }));
    const step = dialog('New company');
    await user.type(within(step).getByLabelText('Company name'), 'Harbour Supply');
    await user.click(within(step).getByRole('button', { name: 'Create company' }));
    await screen.findByRole('dialog', { name: 'Add a contact' });
    expect(screen.getByLabelText('Name')).toHaveValue('Cy Lund');
    expect(screen.getByLabelText(/^Email/)).toHaveValue('cy@example.test');
    expect(screen.getByLabelText(/^Job title/)).toHaveValue('Buyer');
    expect(fieldValue(screen.getByRole('combobox', { name: /^Company/ }))).toBe('c-2');
    expect(Object.fromEntries(customers.createCustomerAction.mock.calls[0][1] as FormData)).toMatchObject({ contactType: 'company', name: 'Harbour Supply' });
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('dialog', { name: 'Contact added' });
    expect(Object.fromEntries(customers.createCustomerAction.mock.calls[1][1] as FormData)).toMatchObject({ name: 'Cy Lund', companyId: 'c-2', affiliationTitle: 'Buyer' });
  });

  it('a refused save keeps what was typed and focuses the reason; closing a changed form asks first', async () => {
    customers.createCustomerAction.mockResolvedValue({ error: 'That email belongs to another contact.', created: false });
    const user = setup();
    await manual(user, 'Company');
    await user.type(screen.getByLabelText('Company name'), 'Harbour View Dental');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('another contact');
    expect(screen.getByLabelText('Company name')).toHaveValue('Harbour View Dental');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(confirmation()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(confirmation()).toBeNull());
    expect(screen.getByLabelText('Company name')).toHaveValue('Harbour View Dental');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(confirmation()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('submits once while saving and closes an untouched form at once, returning focus to its trigger', async () => {
    const save = deferred();
    customers.createCustomerAction.mockReturnValue(save.promise);
    const user = setup();
    await manual(user, 'Company');
    await user.type(screen.getByLabelText('Company name'), 'Northgate Bakery');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(customers.createCustomerAction).toHaveBeenCalledTimes(1);
    await save.resolve({ error: null, created: true, id: 'c-3', contactType: 'company', name: 'Northgate Bakery' });
    await screen.findByRole('dialog', { name: 'Contact added' });
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const trigger = screen.getAllByRole('button', { name: /Add contacts/ })[1];
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: /Create manually/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmation()).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('opens straight into manual creation with the identity preselected from the address', async () => {
    setup(ALL, { defaultOpen: true, initialType: 'company' });
    expect(await screen.findByRole('dialog', { name: 'Add a contact' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Company/ })).toBeChecked();
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();
  });

  it('does not offer View contact to a role that may add contacts but not view them', async () => {
    customers.createCustomerAction.mockResolvedValue({ error: null, created: true, id: 'p-2', contactType: 'person', name: 'Blind Add' });
    const user = setup({ ...ALL, mayView: false });
    await manual(user);
    await user.click(screen.getByRole('radio', { name: /Person/ }));
    await user.type(screen.getByLabelText('Name'), 'Blind Add');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('dialog', { name: 'Contact added' });
    expect(screen.queryByRole('link', { name: 'View contact' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add another' })).toBeInTheDocument();
  });
});
