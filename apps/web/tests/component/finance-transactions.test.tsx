// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Finance V2.0 transaction dialogs, driven as an operator would. Each test asserts what reaches the
 * existing server action and when: a quote line never carries an amount, an invoice is never issued
 * before its confirmation step, a correction is a confirmed signed entry, and a refusal keeps what
 * was typed. Server actions are mocked; the database contract is covered by the invoice suites.
 */

const finance = vi.hoisted(() => ({ financeChoices: vi.fn(), financeReview: vi.fn(), financeMutation: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/finance/actions', () => finance);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/organizations/org/finance' }));

const { QuoteDialog } = await import('@/features/finance/transactions/quote-dialog');
const { InvoiceDialog } = await import('@/features/finance/transactions/invoice-dialog');
const { PaymentDialog } = await import('@/features/finance/transactions/payment-dialog');

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 260)));
const sent = () => Object.fromEntries((finance.financeMutation.mock.calls.at(-1)![1] as FormData).entries());
const line = (id: string, description: string, unitAmountMinor: number, quantity: number, unit = 'hour') => ({ id, description, unit, unitAmountMinor, currency: 'CAD', quantity });
const work = { id: 'w1', title: 'Boiler repair', customer: { id: 'c1', label: 'North Shore Plumbing' }, status: { id: 's1', label: 'Open' } };
const items = [
  { id: 'labour', name: 'Labour', unit: 'hour', unitAmountMinor: 9550, currency: 'CAD', createdAt: '' },
  { id: 'consult', name: 'Consultation', unit: 'hour', unitAmountMinor: 18000, currency: 'USD', createdAt: '' },
];
const invoice = (payments: { id: string; amountMinor: number }[] = []) => ({ id: 'i1', number: 7, currency: 'CAD', billedTo: 'North Shore Plumbing', workItemId: 'w1', issuedAt: '2026-10-01T00:00:00Z', dueAt: null, lines: [{ ...line('l1', 'Emergency callout', 27500, 1, 'callout'), position: 0 }], payments: payments.map(p => ({ ...p, currency: 'CAD', receivedAt: '2026-10-10T12:00:00Z', provider: null, providerReference: null, note: null })) });

beforeEach(() => {
  for (const fn of Object.values(finance)) fn.mockReset();
  finance.financeChoices.mockResolvedValue({ total: 1, rows: [{ id: 'w1', title: 'Boiler repair', detail: 'North Shore Plumbing · Open', meta: '' }] });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('New quote', () => {
  it('starts from Work, previews the snapshotted line and the new total, and sends no amount', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1, 'callout')], items });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Priced line added to quote.', href: '/organizations/org/work/w1?tab=financials' });
    render(<QuoteDialog organizationId="org" />);
    await user.click(screen.getByRole('button', { name: 'New quote' }));
    const dialog = screen.getByRole('dialog', { name: 'New quote' });
    await settle();
    await user.click(within(dialog).getByRole('radio', { name: /Boiler repair/ }));
    await settle();
    expect(within(dialog).getByText('North Shore Plumbing')).toBeVisible();
    await user.selectOptions(within(dialog).getByLabelText('Price item'), 'labour');
    await user.clear(within(dialog).getByLabelText('Quantity'));
    await user.type(within(dialog).getByLabelText('Quantity'), '3');
    expect(within(dialog).getByText('New')).toBeVisible();
    // CA$275.00 already quoted, plus 3 × CA$95.50.
    expect(within(dialog).getByLabelText('Quote totals')).toHaveTextContent('Quote after this lineCA$561.50');
    await user.click(within(dialog).getByRole('button', { name: 'Add to quote' }));
    expect(sent()).toEqual({ organizationId: 'org', kind: 'quote', workItemId: 'w1', priceBookItemId: 'labour', quantity: '3' });
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Priced line added to quote.'));
    expect(within(dialog).getByRole('button', { name: 'Add another line' })).toBeVisible();
  });

  it('refuses a service in another currency before anything is sent', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1)], items });
    render(<QuoteDialog organizationId="org" workItemId="w1" />);
    await user.click(screen.getByRole('button', { name: 'New quote' }));
    await settle();
    await user.selectOptions(screen.getByLabelText('Price item'), 'consult');
    expect(screen.getByText(/A quote has one currency/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add to quote' })).toBeDisabled();
  });

  it('asks before discarding a chosen service, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [], items });
    render(<QuoteDialog organizationId="org" workItemId="w1" />);
    const trigger = screen.getByRole('button', { name: 'New quote' });
    await user.click(trigger);
    await settle();
    await user.selectOptions(screen.getByLabelText('Price item'), 'labour');
    await user.keyboard('{Escape}');
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Price item')).toHaveValue('labour');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New quote' })).toBeNull());
    expect(trigger).toHaveFocus();
    expect(finance.financeMutation).not.toHaveBeenCalled();
  });

  it('explains that a quote needs Work first when there is none', async () => {
    const user = userEvent.setup();
    finance.financeChoices.mockResolvedValue({ total: 0, rows: [] });
    render(<QuoteDialog organizationId="org" mayCreateWork />);
    await user.click(screen.getByRole('button', { name: 'New quote' }));
    await settle();
    expect(screen.getByText(/A quote starts from a Work item/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create Work' })).toHaveAttribute('href', '/organizations/org/work/new?returnTo=quote');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('0 matching Work items.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to quote' })).toBeNull();
  });

  it('offers the catalog prerequisite before Work creation and keeps permission refusals distinct', async () => {
    const user = userEvent.setup();
    finance.financeChoices.mockResolvedValue({ total: 0, rows: [], quotePrerequisite: 'catalog', mayManageCatalog: true, mayCreateWork: true });
    render(<QuoteDialog organizationId="org" mayCreateWork mayManageCatalog />);
    await user.click(screen.getByRole('button', { name: 'New quote' }));
    await settle();
    expect(screen.getByRole('link', { name: 'Open Catalog & pricing' })).toHaveAttribute('href', '/organizations/org/finance/catalog?returnTo=quote');
    expect(screen.queryByRole('link', { name: 'Create Work' })).toBeNull();
    cleanup();
    finance.financeChoices.mockResolvedValue({ total: 0, rows: [], quotePrerequisite: 'forbidden' });
    render(<QuoteDialog organizationId="org" mayCreateWork mayManageCatalog />);
    await user.click(screen.getByRole('button', { name: 'New quote' }));
    await settle();
    expect(screen.getByText(/Your role cannot price Work/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Create Work' })).toBeNull();
  });

  it('keeps an unmatched search separate from an empty business', async () => {
    const user = userEvent.setup();
    render(<QuoteDialog organizationId="org" mayCreateWork />);
    await user.click(screen.getByRole('button', { name: 'New quote' }));
    await settle();
    finance.financeChoices.mockResolvedValue({ total: 0, rows: [] });
    await user.type(screen.getByRole('searchbox'), 'No matching record');
    await settle();
    expect(screen.getByText(/No Work matches this search/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Create Work' })).toBeNull();
  });
});

describe('New invoice', () => {
  it('reviews the priced Work, validates dates, and issues only from the confirmation step', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1, 'callout'), line('l2', 'Labour', 9550, 2)], items });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Invoice issued.', record: 'Invoice #8', href: '/organizations/org/work/w1?tab=financials' });
    render(<InvoiceDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'New invoice' });
    expect(within(dialog).getByLabelText('Invoice total')).toHaveTextContent('CA$466.00');
    expect(within(dialog).getByLabelText('Invoice date')).toHaveValue('2026-10-25');
    await user.type(within(dialog).getByLabelText(/Due date/), '2026-10-20');
    expect(within(dialog).getByText('The due date must be on or after the invoice date.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/Due date/));
    await user.type(within(dialog).getByLabelText(/Due date/), '2026-11-24');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(finance.financeMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('group', { name: 'Confirmation' })).toHaveTextContent('Issue invoice to North Shore Plumbing?');
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(sent()).toEqual({ organizationId: 'org', kind: 'invoice', workItemId: 'w1', issuedAt: '2026-10-25', dueAt: '2026-11-24', confirmed: '1' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Invoice #8 issued'));
  });

  it('offers no issue for Work that already has its invoice', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: invoice(), lines: [line('l1', 'Emergency callout', 27500, 1)], items });
    render(<InvoiceDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    await settle();
    expect(screen.getByText(/already invoiced as #7/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

describe('Record payment', () => {
  it('shows the invoice balance and records a receipt as typed', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: invoice([{ id: 'p1', amountMinor: 20000 }]), lines: [], items });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Payment recorded.', record: 'CA$75.00 on invoice #7', href: '/x' });
    render(<PaymentDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    expect(within(dialog).getByText('Invoice #7')).toBeVisible();
    expect(within(dialog).getByText('Already paid').nextElementSibling).toHaveTextContent('CA$200.00');
    expect(within(dialog).getByLabelText('Balance')).toHaveTextContent('OutstandingCA$75.00');
    await user.type(within(dialog).getByLabelText('Amount (CAD)'), '75.00');
    expect(within(dialog).getByLabelText('Balance')).toHaveTextContent('Outstanding after thisCA$0.00');
    expect(within(dialog).getByText(/does not confirm the money with a payment processor/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(sent()).toMatchObject({ kind: 'payment', workItemId: 'w1', entry: 'receipt', amount: '75.00', receivedAt: '2026-10-25', confirmed: '' });
  });

  it('records a correction only after confirming it, as a signed entry', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: invoice([{ id: 'p1', amountMinor: 27500 }]), lines: [], items });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Correction recorded.', record: '-CA$25.00 on invoice #7', href: '/x' });
    render(<PaymentDialog organizationId="org" workItemId="w1" today="2026-10-25" entry="correction" label="Correction" />);
    await user.click(screen.getByRole('button', { name: 'Correction' }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Record correction' });
    expect(within(dialog).getByRole('radio', { name: /Correction or refund/ })).toBeChecked();
    await user.type(within(dialog).getByLabelText('Amount (CAD)'), '-25');
    expect(within(dialog).getByText(/without a minus sign/)).toBeVisible();
    await user.clear(within(dialog).getByLabelText('Amount (CAD)'));
    await user.type(within(dialog).getByLabelText('Amount (CAD)'), '25');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(finance.financeMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('group', { name: 'Confirmation' })).toHaveTextContent('Record a correction of -CA$25.00?');
    await user.click(within(dialog).getByRole('button', { name: 'Record correction' }));
    expect(sent()).toMatchObject({ entry: 'correction', amount: '25', confirmed: '1' });
  });

  it('keeps every typed value when the server refuses, and moves focus to the reason', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: invoice(), lines: [], items });
    finance.financeMutation.mockResolvedValue({ error: 'You cannot record payments here.' });
    render(<PaymentDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await settle();
    await user.type(screen.getByLabelText('Amount (CAD)'), '10.50');
    await user.type(screen.getByLabelText(/Note/), 'Cheque 1042');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You cannot record payments here.');
    expect(screen.getByLabelText('Amount (CAD)')).toHaveValue('10.50');
    expect(screen.getByLabelText(/Note/)).toHaveValue('Cheque 1042');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
  });
});
