// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddToCallList } from '@/features/communications/voice/add-to-call-list';
import { chooseOption } from '../support/select-field';

const actions = vi.hoisted(() => ({ find: vi.fn(), review: vi.fn(), add: vi.fn(), fields: vi.fn() }));
const customers = vi.hoisted(() => ({ createCustomerAction: vi.fn(), companyOptionsAction: vi.fn(async () => []) }));
const refresh = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/calls/call-list-actions', () => ({
  findCallListContacts: actions.find, reviewCallListContacts: actions.review, addToCallListAction: actions.add, callListContactFields: actions.fields,
  callListTaskOptions: vi.fn(async () => ({ timezone: 'America/Toronto', dueAt: '2026-11-10T10:00', members: [{ id: 'owner', name: 'Alice Owner' }] })),
}));
vi.mock('@/app/organizations/[organizationId]/crm/contacts/actions', () => customers);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast }));

const contacts = [
  { id: 'alice', name: 'Alice Moreau', phone: '+14165550101', onList: false },
  { id: 'bob', name: 'Bob Tran', phone: '+14165550102', onList: false },
  { id: 'cara', name: 'Cara Lee', phone: '+14165550103', onList: true },
  { id: 'dev', name: 'Dev Patel', phone: null, onList: false },
];
const matching = async (_organization: string, search: string) => ({ error: null, contacts: search ? contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : contacts });
/** Steps stay mounted while hidden; queries look only at the step on screen. */
const SHOWN = '[hidden] *, script, style';
const reviewed = (id: string, standing: 'ready' | 'on-list' | 'no-phone') => ({ ...contacts.find(c => c.id === id)!, standing });
beforeEach(() => { actions.find.mockImplementation(matching); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openPicker(props: { mayCreateContacts?: boolean } = {}) {
  const user = userEvent.setup();
  render(<AddToCallList organizationId="tenant" {...props} />);
  await user.click(screen.getByRole('button', { name: 'Add to list' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
  await within(dialog).findByText('Alice Moreau');
  return { user, dialog };
}
async function toDetails(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, ...names: RegExp[]) {
  for (const name of names) await user.click(within(dialog).getByRole('checkbox', { name }));
  await user.click(within(dialog).getByRole('button', { name: 'Next' }));
  await within(dialog).findByLabelText('Due');
}

describe('Add to call list', () => {
  it('keeps one fixed size, and the results where they are, while contacts load and while a search runs', async () => {
    let answer: (value: Awaited<ReturnType<typeof matching>>) => void = () => {};
    actions.find.mockImplementationOnce(matching).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const user = userEvent.setup();
    render(<AddToCallList organizationId="tenant" />);
    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
    expect(dialog.className).toContain('h-[min(92dvh,40rem)]');
    expect(within(dialog).getByText('Loading contacts…')).toBeVisible();
    await within(dialog).findByText('Alice Moreau');
    const region = within(dialog).getByRole('list', { name: 'Contacts' }).parentElement!;
    expect(region).toHaveAttribute('aria-busy', 'false');
    await user.type(within(dialog).getByRole('searchbox', { name: 'Find contacts' }), 'bob');
    // While the new search runs, the earlier results stay in the same region, marked busy.
    await waitFor(() => expect(region).toHaveAttribute('aria-busy', 'true'));
    expect(within(dialog).getByText('Alice Moreau')).toBeVisible();
    await waitFor(() => expect(actions.find).toHaveBeenCalledTimes(2));
    answer({ error: null, contacts: [contacts[1]] });
    await waitFor(() => expect(within(dialog).queryByText('Alice Moreau')).toBeNull());
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(within(dialog).getByRole('list', { name: 'Contacts' }).parentElement).toBe(region);
  });

  it('chooses contacts across searches and moves back and forth without losing choices or details', async () => {
    const { user, dialog } = await openPicker();
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.type(within(dialog).getByRole('searchbox', { name: 'Find contacts' }), 'bob');
    await waitFor(() => expect(within(dialog).queryByText('Alice Moreau')).toBeNull());
    await user.click(within(dialog).getByRole('checkbox', { name: /Bob Tran/ }));
    expect(within(dialog).getByText('2 contacts chosen', { ignore: SHOWN })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    const reason = await within(dialog).findByRole('textbox', { name: 'Reason for calling' });
    expect(within(dialog).getByText('2 contacts chosen', { ignore: SHOWN })).toBeVisible();
    // A reason is required: nothing is called "Call" on anyone's behalf.
    expect(within(dialog).getByRole('button', { name: 'Review' })).toBeDisabled();
    await user.type(reason, 'Spring offer');
    await chooseOption(within(dialog).getByRole('combobox', { name: 'Owner' }), 'Alice Owner');
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Mention the rebate');
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));

    expect(within(dialog).getByRole('checkbox', { name: /Bob Tran/ })).toBeChecked();
    expect(within(dialog).getByRole('searchbox', { name: 'Find contacts' })).toHaveValue('bob');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByRole('textbox', { name: 'Reason for calling' })).toHaveValue('Spring offer');
    expect(within(dialog).getByRole('textbox', { name: /Note/ })).toHaveValue('Mention the rebate');
    expect(within(dialog).getByRole('button', { name: 'Review' })).toBeEnabled();
  });

  it('cannot choose someone already on the list or with no phone number', async () => {
    const { dialog } = await openPicker();
    const onList = within(dialog).getByRole('checkbox', { name: /Cara Lee/ });
    expect(onList).toBeDisabled();
    expect(onList).toHaveAttribute('data-state', 'checked');
    expect(within(dialog).getByText('On the list')).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: /Dev Patel/ })).toBeDisabled();
    expect(within(dialog).getByText('No phone number')).toBeVisible();
  });

  it('reviews the chosen contacts afresh, adds only those still eligible, and shows who was skipped', async () => {
    // Bob was put on the list by someone else after he was chosen.
    actions.review.mockResolvedValue({ error: null, entries: [reviewed('alice', 'ready'), { ...reviewed('bob', 'on-list'), onList: true }] });
    actions.add.mockResolvedValue({ error: null, added: 1, alreadyOnList: 0, noPhone: 0, conflicts: 0, outcomes: { alice: 'added' } });
    const { user, dialog } = await openPicker();
    await toDetails(user, dialog, /Alice Moreau/, /Bob Tran/);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for calling' }), 'Spring offer');
    await user.click(within(dialog).getByRole('button', { name: 'Review' }));

    expect(await within(dialog).findByRole('heading', { name: 'Will be added (1)' })).toBeVisible();
    expect(within(dialog).getByRole('heading', { name: 'Already on the list (1)' })).toBeVisible();
    expect(actions.review).toHaveBeenCalledWith('tenant', ['alice', 'bob']);
    expect(within(dialog).getByText('Spring offer', { ignore: SHOWN })).toBeVisible();
    expect(within(dialog).getByText('Unassigned', { ignore: SHOWN })).toBeVisible();
    expect(within(dialog).getByText(/Nov 10, 2026/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 to list' }));

    await waitFor(() => expect(actions.add).toHaveBeenCalledWith('tenant', { customerIds: ['alice'] }, 'Spring offer', { dueAt: '2026-11-10T10:00', ownerMembershipId: '', notes: '' }));
    expect(toast.success).toHaveBeenCalledWith('Added 1 contact to the call list.');
    expect(refresh).toHaveBeenCalled();
    const result = await within(dialog).findByRole('list', { name: 'Result' });
    expect(within(result).getByText('Alice Moreau').closest('li')).toHaveTextContent('Added');
    expect(within(result).getByText('Bob Tran').closest('li')).toHaveTextContent('Already on the list');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes with a toast when everyone chosen was added, and reports someone added by another person meanwhile', async () => {
    actions.review.mockResolvedValue({ error: null, entries: [reviewed('alice', 'ready')] });
    actions.add.mockResolvedValueOnce({ error: null, added: 1, alreadyOnList: 0, noPhone: 0, conflicts: 0, outcomes: { alice: 'added' } });
    let { user, dialog } = await openPicker();
    await toDetails(user, dialog, /Alice Moreau/);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for calling' }), 'Renewal');
    await user.click(within(dialog).getByRole('button', { name: 'Review' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 to list' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();

    actions.add.mockResolvedValueOnce({ error: null, added: 0, alreadyOnList: 0, noPhone: 0, conflicts: 1, outcomes: { alice: 'conflict' } });
    ({ user, dialog } = await openPicker());
    await toDetails(user, dialog, /Alice Moreau/);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for calling' }), 'Renewal');
    await user.click(within(dialog).getByRole('button', { name: 'Review' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 to list' }));
    expect(await within(dialog).findByText('Added by someone else just now')).toBeVisible();
    expect(toast.success).toHaveBeenLastCalledWith('No one added: 1 contact added by someone else just now.');
  });

  it('keeps the dialog open and shows the reason when adding is refused', async () => {
    actions.review.mockResolvedValue({ error: null, entries: [reviewed('alice', 'ready')] });
    actions.add.mockResolvedValue({ error: 'Your role cannot manage tasks.', added: 0, alreadyOnList: 0, noPhone: 0, conflicts: 0, outcomes: {} });
    const { user, dialog } = await openPicker();
    await toDetails(user, dialog, /Alice Moreau/);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for calling' }), 'Renewal');
    await user.click(within(dialog).getByRole('button', { name: 'Review' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 to list' }));
    expect(await within(dialog).findByText('Your role cannot manage tasks.')).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('creates a contact without leaving, through the canonical command, and chooses them', async () => {
    actions.fields.mockResolvedValue({ error: null, definitions: [] });
    customers.createCustomerAction.mockResolvedValue({ error: null, created: true, id: 'nora', contactType: 'person', name: 'Nora Quinn' });
    const nora = { id: 'nora', name: 'Nora Quinn', phone: '+14165550109', onList: false };
    actions.find.mockImplementation(async (_organization: string, search: string) => ({ error: null, contacts: search.includes('Nora') ? [nora] : contacts }));
    const { user, dialog } = await openPicker({ mayCreateContacts: true });
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create contact' }));
    const form = await screen.findByRole('dialog', { name: 'Add a contact' });
    await user.click(within(form).getByRole('radio', { name: /Person/ }));
    await user.type(within(form).getByLabelText('Name'), 'Nora Quinn');
    await user.click(within(form).getByRole('button', { name: 'Save contact' }));

    const back = await screen.findByRole('dialog', { name: 'Add to call list' });
    expect(Object.fromEntries(customers.createCustomerAction.mock.calls[0][1] as FormData)).toMatchObject({ organizationId: 'tenant', contactType: 'person', name: 'Nora Quinn' });
    await waitFor(() => expect(within(back).getByRole('checkbox', { name: /Nora Quinn/ })).toBeChecked());
    expect(within(back).getByText('2 contacts chosen', { ignore: SHOWN })).toBeVisible();
    expect(toast.success).toHaveBeenCalledWith('Created Nora Quinn.');
  });

  it('returns from creating a contact to the same choices, and offers creation only to a role that may add contacts', async () => {
    actions.fields.mockResolvedValue({ error: null, definitions: [] });
    let { user, dialog } = await openPicker({ mayCreateContacts: true });
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create contact' }));
    const form = await screen.findByRole('dialog', { name: 'Add a contact' });
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
    expect(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ })).toBeChecked();
    expect(customers.createCustomerAction).not.toHaveBeenCalled();
    cleanup();

    ({ user, dialog } = await openPicker());
    expect(within(dialog).queryByRole('button', { name: 'Create contact' })).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Open Contacts' })).toHaveAttribute('href', '/organizations/tenant/crm/contacts');
  });

  it('asks before discarding chosen contacts', async () => {
    const { user, dialog } = await openPicker();
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  });
});
