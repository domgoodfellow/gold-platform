// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseOption } from '../support/select-field';
import { AddToListMenu, callListAddedMessage } from '@/features/communications/voice/add-to-list-menu';
import { ContactSelection, ContactSelectionBar, SelectAllContacts, SelectContact } from '@/features/crm/customers/contact-selection';

const actions = vi.hoisted(() => ({ preview: vi.fn(), add: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/calls/call-list-actions', () => ({ previewAddToCallList: actions.preview, addToCallListAction: actions.add, callListTaskOptions: vi.fn(async () => ({ timezone: 'America/Toronto', dueAt: '2026-11-10T10:00', members: [{ id: 'owner', name: 'Alice Owner' }] })) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { actions.preview.mockResolvedValue({ error: null, matching: 1, toAdd: 1, alreadyOnList: 0, noPhone: 0 }); });

async function chooseCallList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add to…' }));
  return screen.findByRole('menuitem', { name: /Call list/ });
}

describe('Add to…', () => {
  it('uses the same task dialog from a contact record and retains the chosen due date, owner and note', async () => {
    actions.add.mockResolvedValue({ error: null, added: 1, alreadyOnList: 0, noPhone: 0 });
    const user = userEvent.setup();
    render(<AddToListMenu organizationId="tenant" target={{ customerIds: ['alice'] }} standing="ready" />);
    await user.click(await chooseCallList(user));
    expect(actions.add).not.toHaveBeenCalled();
    const due = await screen.findByLabelText('Due');
    fireEvent.change(due, { target: { value: '2026-11-12T14:30' } });
    await chooseOption(screen.getByRole('combobox', { name: 'Owner' }), 'Alice Owner');
    await user.type(screen.getByRole('textbox', { name: /Note/ }), 'Discuss renewal');
    await user.click(screen.getByRole('button', { name: 'Add 1' }));
    await waitFor(() => expect(actions.add).toHaveBeenCalledWith('tenant', { customerIds: ['alice'] }, '', { dueAt: '2026-11-12T14:30', ownerMembershipId: 'owner', notes: 'Discuss renewal' }));
    expect(toast.success).toHaveBeenCalledWith('Added 1 contact to the call list.');
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([['on-list', 'On the list'], ['no-phone', 'No phone number']] as const)('cannot add a contact who is %s, and says why', async (standing, note) => {
    const user = userEvent.setup();
    render(<AddToListMenu organizationId="tenant" target={{ customerIds: ['alice'] }} standing={standing} />);
    const item = await chooseCallList(user);
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent(note);
  });

  it('confirms everyone matching the view first: how many, who is skipped, then adds with the reason', async () => {
    actions.preview.mockResolvedValue({ error: null, matching: 40, toAdd: 34, alreadyOnList: 4, noPhone: 2 });
    actions.add.mockResolvedValue({ error: null, added: 34, alreadyOnList: 4, noPhone: 2 });
    const onAdded = vi.fn();
    const user = userEvent.setup();
    const target = { view: { lifecycle: 'lead', temperature: 'hot' } };
    render(<AddToListMenu organizationId="tenant" target={target} onAdded={onAdded} />);
    await user.click(await chooseCallList(user));
    const dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
    expect(await within(dialog).findByText('40 contacts in the current search and filters.')).toBeVisible();
    expect(within(dialog).getByText('34 contacts will be added.')).toBeVisible();
    expect(within(dialog).getByText('Skipped: 4 contacts already on the list, 2 contacts with no phone number.')).toBeVisible();
    expect(actions.preview).toHaveBeenCalledWith('tenant', target);
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Spring offer');
    await user.click(within(dialog).getByRole('button', { name: 'Add 34' }));
    await waitFor(() => expect(actions.add).toHaveBeenCalledWith('tenant', target, 'Spring offer', { dueAt: '2026-11-10T10:00', ownerMembershipId: '', notes: '' }));
    expect(toast.success).toHaveBeenCalledWith('Added 34 contacts to the call list. Skipped 4 contacts already on it, 2 contacts with no phone number.');
    expect(onAdded).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cannot add when no one can be added, and shows a refusal from the server', async () => {
    actions.preview.mockResolvedValueOnce({ error: null, matching: 3, toAdd: 0, alreadyOnList: 3, noPhone: 0 });
    const user = userEvent.setup();
    const app = render(<AddToListMenu organizationId="tenant" target={{ customerIds: ['a', 'b', 'c'] }} />);
    await user.click(await chooseCallList(user));
    let dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
    expect(await within(dialog).findByText('No one here can be added.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(within(dialog).queryByRole('textbox', { name: /Reason/ })).toBeNull();
    app.unmount();
    actions.preview.mockResolvedValueOnce({ error: 'More than 500 contacts match. Narrow the search or filters first.', matching: 0, toAdd: 0, alreadyOnList: 0, noPhone: 0 });
    render(<AddToListMenu organizationId="tenant" target={{ view: {} }} />);
    await user.click(await chooseCallList(user));
    dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
    expect(await within(dialog).findByText('More than 500 contacts match. Narrow the search or filters first.')).toBeVisible();
  });

  it('words the toast for every mix of added and skipped', () => {
    expect(callListAddedMessage({ added: 1, alreadyOnList: 0, noPhone: 0 })).toBe('Added 1 contact to the call list.');
    expect(callListAddedMessage({ added: 0, alreadyOnList: 2, noPhone: 1 })).toBe('No one added: 2 contacts already on it, 1 contact with no phone number.');
  });
});

describe('ticking contacts', () => {
  const page = (ids: string[]) => <ContactSelection pageIds={ids}>
    <ContactSelectionBar organizationId="tenant" />
    <SelectAllContacts ids={ids} />
    {ids.map(id => <SelectContact key={id} id={id} name={`Contact ${id}`} />)}
  </ContactSelection>;

  it('shows the bar with a count while anything is ticked; select all and Clear work', async () => {
    const user = userEvent.setup();
    render(page(['a', 'b', 'c']));
    expect(screen.queryByRole('region', { name: 'Selected contacts' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Contact b' }));
    const bar = screen.getByRole('region', { name: 'Selected contacts' });
    expect(bar).toHaveTextContent('1 selected');
    expect(screen.getByRole('checkbox', { name: 'Select all shown' })).toHaveAttribute('data-state', 'indeterminate');
    await user.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    expect(bar).toHaveTextContent('3 selected');
    expect(within(bar).getByRole('button', { name: 'Add to…' })).toBeVisible();
    await user.click(within(bar).getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('region', { name: 'Selected contacts' })).toBeNull();
  });

  it('drops ticks for rows no longer shown when the page or filters change', async () => {
    const user = userEvent.setup();
    const app = render(page(['a', 'b']));
    await user.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    app.rerender(page(['b', 'c']));
    expect(screen.getByRole('region', { name: 'Selected contacts' })).toHaveTextContent('1 selected');
    expect(screen.getByRole('checkbox', { name: 'Select Contact b' })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('checkbox', { name: 'Select Contact c' })).toHaveAttribute('data-state', 'unchecked');
  });
});
