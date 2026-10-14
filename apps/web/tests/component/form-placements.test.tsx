// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDefinition, FormPublication } from '@gold/schemas';
import { PublicForm } from '@/features/forms/public-form';
import { FormSection } from '@/features/public-site/form-section';
import { PortalForms } from '@/features/portal-access/portal-forms';

const actions = vi.hoisted(() => ({
  submitFormByKeyAction: vi.fn(async () => ({ status: 'sent' as const })),
  submitPortalFormAction: vi.fn(async () => ({ status: 'sent' as const })),
}));
vi.mock('@/app/(public)/forms/actions', () => actions);
vi.mock('@/app/(public)/portal/actions', () => actions);

const DEFINITION: FormDefinition = {
  title: 'Request a quote',
  submitLabel: 'Send',
  confirmation: { title: 'Thank you', message: 'Soon.' },
  fields: [
    { id: 'name', type: 'short_text', label: 'Your name', required: true },
    { id: 'size', type: 'radio', label: 'Size', required: true, options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] },
  ],
};
const PUBLICATION: FormPublication = {
  formId: '11111111-1111-4111-8111-111111111111',
  publicKey: 'abcdef012345',
  revisionId: '22222222-2222-4222-8222-222222222222',
  revisionNumber: 1,
  name: 'Quote',
  definition: DEFINITION,
};

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Object.values(actions).forEach((mock) => mock.mockClear());
});
afterEach(cleanup);

describe('the website form section', () => {
  const base = { heading: 'Ask us', body: 'We reply fast.', formId: PUBLICATION.formId };

  it('draws the shared form with the business\'s own words around it, submitting as the website', async () => {
    const user = userEvent.setup();
    render(<FormSection {...base} context={{ mode: 'live', forms: { [PUBLICATION.formId]: PUBLICATION } }} />);
    expect(screen.getByRole('heading', { name: 'Ask us' })).toBeTruthy();
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.click(screen.getByLabelText('Small'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(actions.submitFormByKeyAction).toHaveBeenCalledTimes(1));
    expect(actions.submitFormByKeyAction).toHaveBeenCalledWith(expect.objectContaining({ publicKey: 'abcdef012345', source: 'website', revisionId: PUBLICATION.revisionId, answers: { name: 'Ada', size: 's' } }));
    expect(await screen.findByText('Thank you')).toBeTruthy();
  });

  it('draws nothing on a public page when the form is not published, instead of a hole', () => {
    const { container } = render(<FormSection {...base} context={{ mode: 'live', forms: {} }} />);
    expect(container.textContent).toBe('');
  });

  it('says so in a private preview, and does not submit', () => {
    render(<FormSection {...base} context={{ mode: 'preview', forms: {} }} />);
    expect(screen.getByText(/not published, so visitors will see nothing/)).toBeTruthy();
  });

  it('shows only the form\'s name in the Studio canvas', () => {
    render(<FormSection {...base} context={{ mode: 'canvas', forms: {}, formNames: { [PUBLICATION.formId]: 'Quote' } }} />);
    expect(screen.getByText('Form: Quote')).toBeTruthy();
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });
});

describe('the public form\'s keyboard behaviour', () => {
  it('moves focus to the first field with a problem after a refused submit, and names the problem', async () => {
    const user = userEvent.setup();
    render(<PublicForm definition={DEFINITION} revisionId="r" submit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Your name')));
    expect(screen.getByRole('alert').textContent).toMatch(/check the highlighted/i);
    expect(screen.getByLabelText('Your name').getAttribute('aria-describedby')).toContain('error');
  });

  it('shows the confirmation the business wrote once it is sent', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => ({ status: 'sent' as const }));
    render(<PublicForm definition={DEFINITION} revisionId="r" submit={submit} />);
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.click(screen.getByLabelText('Large'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('status')).textContent).toContain('Thank you');
  });

  it('sends a honeypot value so the server can discard it, and never shows the field', async () => {
    render(<PublicForm definition={DEFINITION} revisionId="r" submit={vi.fn()} />);
    const trap = document.querySelector('[aria-hidden="true"] input') as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
  });
});

describe('the portal list', () => {
  it('opens a published revision in place and submits without customer identity', async () => {
    const user = userEvent.setup();
    render(<PortalForms forms={[PUBLICATION]} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.click(screen.getByLabelText('Small'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(actions.submitPortalFormAction).toHaveBeenCalledTimes(1));
    expect(actions.submitPortalFormAction).toHaveBeenCalledWith({ formId: PUBLICATION.formId, revisionId: PUBLICATION.revisionId, answers: { name: 'Ada', size: 's' } });
  });
});
