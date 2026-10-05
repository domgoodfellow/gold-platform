// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDefinition } from '@gold/schemas';
import { WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import { FormBuilder } from '@/features/studio/forms/form-builder';
import { FormRenderer } from '@/features/forms/form-renderer';
import type { FormEditorState } from '@/lib/domain/forms/forms';

const actions = vi.hoisted(() => ({
  createFormDraftAction: vi.fn(async () => ({ error: null })),
  setPortalFormAction: vi.fn(async () => ({ error: null })),
  publishFormAction: vi.fn(async () => ({ error: null })),
  renameFormAction: vi.fn(async () => ({ error: null })),
  saveFormDraftAction: vi.fn(async () => ({ error: null })),
  setFormArchivedAction: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/app/organizations/[organizationId]/studio/forms/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DEFINITION: FormDefinition = {
  title: 'Request a quote',
  submitLabel: 'Send',
  confirmation: { title: 'Thanks', message: '' },
  fields: [
    { id: 'name', type: 'short_text', label: 'Your name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
  ],
};

function state(overrides: Partial<FormEditorState> = {}): FormEditorState {
  return {
    form: { id: 'f1', name: 'Quote', slug: 'quote', publicKey: 'abcdef012345', archived: false, createdFromTemplateKey: null },
    placements: { websitePublished: false, websiteDraft: false, portal: false, booking: false },
    published: null,
    working: { id: 'r1', number: 1, status: 'draft', definition: DEFINITION, publishedAt: null },
    history: [],
    ...overrides,
  };
}

function renderBuilder(next = state()) {
  return render(
    <WorkspaceRailProvider>
      <FormBuilder organizationId="o1" state={next} distribution={{ origin: 'http://localhost:3000', organizationSlug: 'acme', siteHostname: null }} />
    </WorkspaceRailProvider>,
  );
}

beforeEach(() => {
  // Radix's Checkbox measures itself; jsdom has no layout engine to offer one.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  Object.values(actions).forEach((mock) => mock.mockClear());
});
afterEach(cleanup);

const structure = () => screen.getByRole('navigation', { name: 'Form structure' });

describe('form builder', () => {
  it('starts saved, and marks the draft unsaved after an edit', async () => {
    const user = userEvent.setup();
    renderBuilder();
    expect(screen.getByText('Saved')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Short text' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('adds a field, selects it and shows it in the live preview', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByRole('button', { name: 'Dropdown' }));
    // The new field is selected: its inspector is showing.
    expect(screen.getByRole('heading', { name: 'Dropdown' })).toBeTruthy();
    // And the preview — the shared renderer — renders it as a labelled control.
    expect(screen.getAllByLabelText(/^Dropdown/).length).toBeGreaterThan(0);
  });

  it('edits a label without changing the field\'s identity', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(within(structure()).getByRole('button', { name: /^Your name/ }));
    const label = screen.getByLabelText('Question');
    await user.clear(label);
    await user.type(label, 'Full name');
    expect(screen.getByText('name')).toBeTruthy(); // the id, unchanged
    expect(within(structure()).getByRole('button', { name: /^Full name/ })).toBeTruthy();
  });

  it('removes a field', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByRole('button', { name: 'Remove “Email”' }));
    expect(within(structure()).queryByText('Email')).toBeNull();
  });

  it('reorders with buttons, not only drag', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByRole('button', { name: 'Move “Your name” down' }));
    const rows = within(structure()).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Email');
    expect(rows[1].textContent).toContain('Your name');
    expect((screen.getByRole('button', { name: 'Move “Email” up' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the draft revision, and publishes with what is on screen', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(screen.getByRole('button', { name: 'Phone' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(actions.saveFormDraftAction).toHaveBeenCalledTimes(1);
    const saved = actions.saveFormDraftAction.mock.calls[0] as unknown as [{ revisionId: string; definition: FormDefinition }];
    expect(saved[0].revisionId).toBe('r1');
    expect(saved[0].definition.fields.map((field) => field.id)).toEqual(['name', 'email', 'phone']);

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(actions.publishFormAction).toHaveBeenCalledTimes(1);
  });

  it('will not publish a form with no questions', () => {
    renderBuilder(state({ working: { id: 'r1', number: 1, status: 'draft', definition: { ...DEFINITION, fields: [] }, publishedAt: null } }));
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the live version visible and says so while a draft is open', () => {
    renderBuilder(state({ published: { id: 'p1', number: 1, status: 'published', definition: DEFINITION, publishedAt: '2026-01-01T00:00:00Z' }, working: { id: 'r2', number: 2, status: 'draft', definition: DEFINITION, publishedAt: null } }));
    expect(screen.getByText(/Visitors keep seeing Revision 1/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open public form' }).getAttribute('href')).toBe('/f/abcdef012345');
  });

  it('with no draft, offers to edit a published form instead of editing it in place', async () => {
    const user = userEvent.setup();
    renderBuilder(state({ working: null, published: { id: 'p1', number: 3, status: 'published', definition: DEFINITION, publishedAt: '2026-01-01T00:00:00Z' } }));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit form' }));
    expect(actions.createFormDraftAction).toHaveBeenCalledWith({ organizationId: 'o1', formId: 'f1' });
  });
});

describe('form renderer', () => {
  it('associates every label, hint and error with its control', () => {
    render(
      <FormRenderer
        definition={{ ...DEFINITION, fields: [{ id: 'email', type: 'email', label: 'Email', description: 'We reply here.', required: true }] }}
        values={{}}
        errors={{ email: 'That email address is not valid.' }}
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['We reply here.', 'That email address is not valid.']);
  });

  it('names a group of choices with a legend and a consent box with its own label', () => {
    render(
      <FormRenderer
        definition={{
          ...DEFINITION,
          fields: [
            { id: 'size', type: 'radio', label: 'Size', required: true, options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] },
            { id: 'ok', type: 'consent', label: 'I agree', required: true },
          ],
        }}
        values={{}}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: 'Size' })).toBeTruthy();
    expect(screen.getByLabelText('Small')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeTruthy();
  });
});
