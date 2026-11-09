// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddToCallList } from '@/features/communications/voice/add-to-call-list';

const actions = vi.hoisted(() => ({ find: vi.fn(), add: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/calls/call-list-actions', () => ({ findCallListContacts: actions.find, addToCallListAction: actions.add }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast }));

const contacts = [
  { id: 'alice', name: 'Alice Moreau', phone: '+14165550101', onList: false },
  { id: 'bob', name: 'Bob Tran', phone: '+14165550102', onList: false },
  { id: 'cara', name: 'Cara Lee', phone: '+14165550103', onList: true },
  { id: 'dev', name: 'Dev Patel', phone: null, onList: false },
];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openPicker() {
  const user = userEvent.setup();
  render(<AddToCallList organizationId="tenant" />);
  await user.click(screen.getByRole('button', { name: 'Add to list' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add to call list' });
  await within(dialog).findByText('Alice Moreau');
  return { user, dialog };
}

describe('Add to call list', () => {
  it('adds the chosen contacts in one step, kept across searches, and confirms with a toast', async () => {
    actions.find.mockImplementation(async (_organization: string, search: string) => ({ error: null, contacts: search ? contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : contacts }));
    actions.add.mockResolvedValue({ error: null, added: 2, alreadyOnList: 0, noPhone: 0 });
    const { user, dialog } = await openPicker();
    expect(within(dialog).getByRole('button', { name: 'Add to list' })).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.type(within(dialog).getByRole('searchbox', { name: 'Find contacts' }), 'bob');
    await waitFor(() => expect(within(dialog).queryByText('Alice Moreau')).toBeNull());
    await user.click(within(dialog).getByRole('checkbox', { name: /Bob Tran/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Spring offer');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 to list' }));
    await waitFor(() => expect(actions.add).toHaveBeenCalledWith('tenant', { customerIds: ['alice', 'bob'] }, 'Spring offer'));
    expect(toast.success).toHaveBeenCalledWith('Added 2 contacts to the call list.');
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add to call list' })).toBeNull());
  });

  it('cannot pick someone already on the list or with no phone number', async () => {
    actions.find.mockResolvedValue({ error: null, contacts });
    const { dialog } = await openPicker();
    const onList = within(dialog).getByRole('checkbox', { name: /Cara Lee/ });
    expect(onList).toBeDisabled();
    expect(onList).toHaveAttribute('data-state', 'checked');
    expect(within(dialog).getByText('On the list')).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: /Dev Patel/ })).toBeDisabled();
    expect(within(dialog).getByText('No phone number')).toBeVisible();
  });

  it('keeps the dialog open and shows the reason when adding is refused', async () => {
    actions.find.mockResolvedValue({ error: null, contacts });
    actions.add.mockResolvedValue({ error: 'Your role cannot manage tasks.', added: 0, alreadyOnList: 0, noPhone: 0 });
    const { user, dialog } = await openPicker();
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 to list' }));
    expect(await within(dialog).findByText('Your role cannot manage tasks.')).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('asks before discarding chosen contacts', async () => {
    actions.find.mockResolvedValue({ error: null, contacts });
    const { user, dialog } = await openPicker();
    await user.click(within(dialog).getByRole('checkbox', { name: /Alice Moreau/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  });
});
