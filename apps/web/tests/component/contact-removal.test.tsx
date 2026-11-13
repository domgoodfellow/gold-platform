// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactRemovalActions } from '@/features/crm/customers/contact-removal';

const actions = vi.hoisted(() => ({ archiveContactAction: vi.fn(), restoreContactAction: vi.fn(), deleteContactAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/crm/contacts/[contactId]/removal-actions', () => actions);
vi.mock('next/navigation', async (original) => ({ ...(await original<typeof import('next/navigation')>()), useRouter: () => router }));
vi.mock('sonner', () => ({ toast }));

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = async (name = 'Ada') => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `More actions for ${name}` }));
  return user;
};

describe('Archive, Restore and Delete permanently on a contact', () => {
  it('archives after confirming, keeping the contact, and says so', async () => {
    actions.archiveContactAction.mockResolvedValue({ error: null });
    render(<ContactRemovalActions organizationId="org" contactId="ada" name="Ada" removal={{ archived: false, retained: [] }} />);
    const user = await open();
    expect(screen.queryByRole('menuitem', { name: 'Restore contact' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Archive contact' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Archive Ada?' });
    expect(confirm).toHaveTextContent('Their records and history are kept, and you can restore them.');
    expect(actions.archiveContactAction).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Archive contact' }));
    await waitFor(() => expect(actions.archiveContactAction).toHaveBeenCalledWith('org', 'ada'));
    expect(toast.success).toHaveBeenCalledWith('Archived Ada.');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('offers Restore for an archived contact', async () => {
    actions.restoreContactAction.mockResolvedValue({ error: null });
    render(<ContactRemovalActions organizationId="org" contactId="ada" name="Ada" removal={{ archived: true, retained: ['tasks'] }} />);
    const user = await open();
    expect(screen.queryByRole('menuitem', { name: 'Archive contact' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Restore contact' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Restore Ada?' })).getByRole('button', { name: 'Restore contact' }));
    await waitFor(() => expect(actions.restoreContactAction).toHaveBeenCalledWith('org', 'ada'));
    expect(toast.success).toHaveBeenCalledWith('Restored Ada.');
  });

  it('deletes permanently only after a confirmation that says it cannot be undone, then leaves the record', async () => {
    actions.deleteContactAction.mockResolvedValue({ error: null });
    render(<ContactRemovalActions organizationId="org" contactId="ada" name="Ada" removal={{ archived: false, retained: [] }} />);
    const user = await open();
    await user.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Ada permanently?' });
    expect(confirm).toHaveTextContent('can’t be restored');
    await user.click(within(confirm).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(actions.deleteContactAction).toHaveBeenCalledWith('org', 'ada'));
    expect(toast.success).toHaveBeenCalledWith('Deleted Ada.');
    expect(router.push).toHaveBeenCalledWith('/organizations/org/crm/contacts');
  });

  it('explains which kinds of record keep a contact, offers Archive instead, and never deletes', async () => {
    actions.archiveContactAction.mockResolvedValue({ error: null });
    render(<ContactRemovalActions organizationId="org" contactId="ada" name="Ada" removal={{ archived: false, retained: ['opportunities', 'calls'] }} />);
    const user = await open();
    await user.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
    const blocked = await screen.findByRole('alertdialog', { name: 'Ada can’t be deleted' });
    expect(within(blocked).getByRole('list', { name: 'Records that must be kept' })).toHaveTextContent('OpportunitiesCall history');
    expect(within(blocked).queryByRole('button', { name: 'Delete permanently' })).toBeNull();
    await user.click(within(blocked).getByRole('button', { name: 'Archive contact' }));
    await waitFor(() => expect(actions.archiveContactAction).toHaveBeenCalledWith('org', 'ada'));
    expect(actions.deleteContactAction).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the reason when the database refuses', async () => {
    actions.deleteContactAction.mockResolvedValue({ error: 'This contact has records that must be kept. Archive it instead.' });
    render(<ContactRemovalActions organizationId="org" contactId="ada" name="Ada" removal={{ archived: false, retained: [] }} />);
    const user = await open();
    await user.click(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete permanently' }));
    expect(await within(confirm).findByText('This contact has records that must be kept. Archive it instead.')).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });
});
