// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagePanel, WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import { CreateFieldSheet } from '@/features/custom-fields/configuration/create-field-sheet';
import { EditFieldSheet } from '@/features/custom-fields/configuration/edit-field-sheet';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

const actions = vi.hoisted(() => ({ createFieldAction: vi.fn(), updateFieldAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/settings/custom-fields/actions', () => actions);

const definition: FieldDefinition = {
  id: 'f1', organizationId: 'org', entityType: 'customer', key: 'site_access', label: 'Site access notes',
  kind: 'text', required: false, position: 2, options: [],
} as unknown as FieldDefinition;

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
const confirmation = () => screen.queryByRole('dialog', { name: 'Discard unsaved changes?' });
const newFieldDrawer = () => screen.queryByRole('dialog', { name: 'New field' });

function renderCreate() {
  const user = userEvent.setup();
  render(<WorkspaceRailProvider><CreateFieldSheet organizationId="org" entityType="customer" /><PagePanel /></WorkspaceRailProvider>);
  return user;
}

beforeEach(() => {
  actions.createFieldAction.mockReset();
  actions.updateFieldAction.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('New customer field drawer', () => {
  it('keeps its actions in the footer, associated with the form, outside the scrolling body', async () => {
    const user = renderCreate();
    await user.click(screen.getByRole('button', { name: /New field/ }));
    const drawer = newFieldDrawer()!;
    const submit = within(drawer).getByRole('button', { name: 'Add field' });
    const form = drawer.querySelector('form')!;
    expect(submit).toHaveAttribute('form', form.id);
    expect(form.contains(submit)).toBe(false);
    expect(submit.closest('[data-drawer-footer]')).not.toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Cancel' }).closest('[data-drawer-footer]')).not.toBeNull();
    expect(form.closest('[data-drawer-body]')).not.toBeNull();
  });

  it('a refused save keeps what was typed, announces the reason, and Escape still asks before discarding', async () => {
    actions.createFieldAction.mockResolvedValue({ error: 'A field called site_access already exists here.', created: false });
    const user = renderCreate();
    await user.click(screen.getByRole('button', { name: /New field/ }));
    await user.type(screen.getByLabelText('Label'), 'Site access');
    await user.type(screen.getByLabelText('Key'), 'site_access');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('already exists');
    expect(screen.getByLabelText('Label')).toHaveValue('Site access');
    expect(screen.getByLabelText('Key')).toHaveValue('site_access');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(confirmation()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(newFieldDrawer()).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: /New field/ })).toHaveFocus());
  });

  it('submits once while saving, and a successful save closes without asking', async () => {
    let resolve: (value: unknown) => void = () => {};
    actions.createFieldAction.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = renderCreate();
    await user.click(screen.getByRole('button', { name: /New field/ }));
    await user.type(screen.getByLabelText('Label'), 'Renewal date');
    await user.type(screen.getByLabelText('Key'), 'renewal_date');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Adding…' }));
    expect(actions.createFieldAction).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ error: null, created: true }));
    await waitFor(() => expect(newFieldDrawer()).toBeNull());
    expect(confirmation()).toBeNull();
  });

  it('a corrected retry after a refusal saves and closes', async () => {
    let resolve: (value: unknown) => void = () => {};
    actions.createFieldAction.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = renderCreate();
    await user.click(screen.getByRole('button', { name: /New field/ }));
    await user.type(screen.getByLabelText('Label'), 'Site access');
    await user.type(screen.getByLabelText('Key'), 'site_access');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await act(async () => resolve({ error: 'A field called site_access already exists here.', created: false }));
    await screen.findByRole('alert');
    await user.clear(screen.getByLabelText('Key'));
    await user.type(screen.getByLabelText('Key'), 'site_access_notes');
    // A second action chains on the first and suspends; it must be submitted inside an awaited act.
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Add field' })); });
    expect(actions.createFieldAction).toHaveBeenCalledTimes(2);
    expect(actions.createFieldAction.mock.calls[1][1].get('key')).toBe('site_access_notes');
    await act(async () => resolve({ error: null, created: true }));
    await waitFor(() => expect(newFieldDrawer()).toBeNull());
    expect(confirmation()).toBeNull();
  });

  it('closes at once when nothing was typed', async () => {
    const user = renderCreate();
    await user.click(screen.getByRole('button', { name: /New field/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmation()).toBeNull();
    expect(newFieldDrawer()).toBeNull();
  });
});

describe('Edit customer field drawer', () => {
  function renderEdit() {
    const user = userEvent.setup();
    render(<WorkspaceRailProvider><EditFieldSheet organizationId="org" definition={definition} /><PagePanel /></WorkspaceRailProvider>);
    return user;
  }

  it('shows the persisted values in labelled fields and its identity as metadata', async () => {
    const user = renderEdit();
    await user.click(screen.getByRole('button', { name: 'Edit Site access notes' }));
    const drawer = screen.getByRole('dialog', { name: 'Edit Site access notes' });
    expect(within(drawer).getByLabelText('Label')).toHaveValue('Site access notes');
    expect(within(drawer).getByLabelText('Position')).toHaveValue(2);
    expect(within(drawer).getByText('site_access')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Save changes' }).closest('[data-drawer-footer]')).not.toBeNull();
  });

  it('asks before discarding an edited label and closes at once when unchanged', async () => {
    const user = renderEdit();
    await user.click(screen.getByRole('button', { name: 'Edit Site access notes' }));
    await user.keyboard('{Escape}');
    expect(confirmation()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit Site access notes' }));
    await user.type(screen.getByLabelText('Label'), ' (gate code)');
    await settle();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(confirmation()).not.toBeNull();
  });

  it('a refused edit stays open with the reason in the form; a successful edit closes without asking', async () => {
    let resolve: (value: unknown) => void = () => {};
    actions.updateFieldAction
      .mockResolvedValueOnce({ error: 'A label is required.', updated: false })
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const user = renderEdit();
    await user.click(screen.getByRole('button', { name: 'Edit Site access notes' }));
    await user.type(screen.getByLabelText('Label'), ' (gate code)');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A label is required.');
    expect(screen.getByRole('dialog', { name: 'Edit Site access notes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toHaveValue('Site access notes (gate code)');
    // A second action chains on the first and suspends; it must be submitted inside an awaited act.
    await act(async () => { await user.click(screen.getByRole('button', { name: 'Save changes' })); });
    expect(actions.updateFieldAction).toHaveBeenCalledTimes(2);
    await act(async () => resolve({ error: null, updated: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Site access notes' })).toBeNull());
    expect(confirmation()).toBeNull();
  });

  it('typing a change and undoing it is not a change', async () => {
    const user = renderEdit();
    await user.click(screen.getByRole('button', { name: 'Edit Site access notes' }));
    await user.type(screen.getByLabelText('Label'), 'x');
    await user.type(screen.getByLabelText('Label'), '{Backspace}');
    await settle();
    await user.keyboard('{Escape}');
    expect(confirmation()).toBeNull();
  });
});
