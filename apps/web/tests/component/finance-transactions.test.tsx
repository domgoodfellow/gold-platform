// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseOption, fieldValue } from '../support/select-field';

/**
 * Finance V2.0 transaction dialogs, driven as an operator would. Each test asserts what reaches the
 * existing server action and when: a quote line never carries an amount, an invoice is never issued
 * before its confirmation step, a correction is a confirmed signed entry, and a refusal keeps what
 * was typed. Server actions are mocked; the database contract is covered by the invoice suites.
 */

const finance = vi.hoisted(() => ({ financeChoices: vi.fn(), financeReview: vi.fn(), financePaymentReview: vi.fn(), financeDirectInvoiceReview: vi.fn(), financeMutation: vi.fn(), previewInvoiceDocument: vi.fn(), createInvoiceDocument: vi.fn(), invoiceEmailDraft: vi.fn(), sendInvoiceEmail: vi.fn(), retryInvoiceEmailSend: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/finance/actions', () => finance);
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/organizations/org/finance', useSearchParams: () => new URLSearchParams() }));

const { QuoteDialog } = await import('@/features/finance/transactions/quote-dialog');
const { InvoiceDialog } = await import('@/features/finance/transactions/invoice-dialog');
const { PaymentDialog } = await import('@/features/finance/transactions/payment-dialog');
const { InvoiceInspector } = await import('@/features/finance/collections/invoice-inspector');
const { PagePanel, WorkspaceRailProvider } = await import('@/components/panels/workspace-right-rail');

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 260)));
const sent = () => Object.fromEntries((finance.financeMutation.mock.calls.at(-1)![1] as FormData).entries());
const line = (id: string, description: string, unitAmountMinor: number, quantity: number, unit = 'hour') => ({ id, description, unit, unitAmountMinor, currency: 'CAD', quantity });
const work = { id: 'w1', title: 'Boiler repair', customer: { id: 'c1', label: 'North Shore Plumbing' }, status: { id: 's1', label: 'Open' } };
const items = [
  { id: 'labour', name: 'Labour', unit: 'hour', unitAmountMinor: 9550, currency: 'CAD', createdAt: '' },
  { id: 'consult', name: 'Consultation', unit: 'hour', unitAmountMinor: 18000, currency: 'USD', createdAt: '' },
];
const invoice = (payments: { id: string; amountMinor: number }[] = []) => ({ id: 'i1', source: 'work_item' as const, number: 7, currency: 'CAD', billedTo: 'North Shore Plumbing', workItemId: 'w1', issuedAt: '2026-10-01T00:00:00Z', dueAt: null, lines: [{ ...line('l1', 'Emergency callout', 27500, 1, 'callout'), position: 0 }], payments: payments.map(p => ({ ...p, currency: 'CAD', receivedAt: '2026-10-10T12:00:00Z', provider: null, providerReference: null, note: null })) });

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
    await chooseOption(within(dialog).getByLabelText('Price item'), 'labour');
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
    await chooseOption(screen.getByLabelText('Price item'), 'consult');
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
    await chooseOption(screen.getByLabelText('Price item'), 'labour');
    await user.keyboard('{Escape}');
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(fieldValue(screen.getByLabelText('Price item'))).toBe('labour');
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
    finance.financePaymentReview.mockResolvedValue({ invoice: invoice([{ id: 'p1', amountMinor: 20000 }]) });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Payment recorded.', record: 'CA$75.00 on invoice #7', href: '/x' });
    render(<PaymentDialog organizationId="org" invoiceId="i1" today="2026-10-25" />);
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
    expect(sent()).toMatchObject({ kind: 'payment', invoiceId: 'i1', entry: 'receipt', amount: '75.00', receivedAt: '2026-10-25', confirmed: '' });
  });

  it('records a correction only after confirming it, as a signed entry', async () => {
    const user = userEvent.setup();
    finance.financePaymentReview.mockResolvedValue({ invoice: invoice([{ id: 'p1', amountMinor: 27500 }]) });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Correction recorded.', record: '-CA$25.00 on invoice #7', href: '/x' });
    render(<PaymentDialog organizationId="org" invoiceId="i1" today="2026-10-25" entry="correction" label="Correction" />);
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
    finance.financePaymentReview.mockResolvedValue({ invoice: invoice() });
    finance.financeMutation.mockResolvedValue({ error: 'You cannot record payments here.' });
    render(<PaymentDialog organizationId="org" invoiceId="i1" today="2026-10-25" />);
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

describe('New invoice, directly from catalog items', () => {
  const choose = async (user: ReturnType<typeof userEvent.setup>) => {
    finance.financeChoices.mockResolvedValue({ total: 1, rows: [{ id: 'c1', title: 'North Shore Plumbing', detail: 'office@northshore.test', meta: '' }] });
    finance.financeDirectInvoiceReview.mockResolvedValue({ customer: { id: 'c1', name: 'North Shore Plumbing' }, items, currency: 'CAD' });
    render(<InvoiceDialog organizationId="org" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    const dialog = screen.getByRole('dialog', { name: 'New invoice' });
    await user.click(within(dialog).getByRole('radio', { name: /A customer, from catalog items/ }));
    await settle();
    expect(finance.financeChoices).toHaveBeenLastCalledWith('org', 'customer', '', { includeSettled: false });
    await user.click(within(dialog).getByRole('radio', { name: /North Shore Plumbing/ }));
    await settle();
    return dialog;
  };

  it('sends a customer, catalog items and quantities and never an amount, only after confirming', async () => {
    const user = userEvent.setup();
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Invoice issued.', record: 'Invoice #9', href: '/organizations/org/finance/invoices?invoice=i9' });
    const dialog = await choose(user);
    expect(within(dialog).getByText('Invoiced directly, with no Work item')).toBeVisible();
    await chooseOption(within(dialog).getByLabelText('Item 1'), 'labour');
    await user.clear(within(dialog).getByLabelText('Quantity'));
    await user.type(within(dialog).getByLabelText('Quantity'), '2');
    // 2 × CA$95.50, through the one price calculation.
    expect(within(dialog).getByLabelText('Invoice total')).toHaveTextContent('CA$191.00');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(finance.financeMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('group', { name: 'Confirmation' })).toHaveTextContent('Issue invoice to North Shore Plumbing?');
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    const form = sent();
    expect(form).toMatchObject({ organizationId: 'org', kind: 'invoice', source: 'direct', customerId: 'c1', issuedAt: '2026-10-25', dueAt: '', confirmed: '1' });
    expect(JSON.parse(String(form.lines))).toEqual([{ priceBookItemId: 'labour', quantity: 2 }]);
    expect(String(form.issuanceKey)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(form).some((key) => /amount|price(?!BookItemId)|total|discount/i.test(key))).toBe(false);
    expect(String(form.lines)).not.toMatch(/amount|unit|currency|total|discount/i);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Invoice #9 issued'));
  });

  it('keeps one issuance key across a refused and a repeated confirmation, so a retry is the same request', async () => {
    const user = userEvent.setup();
    finance.financeMutation.mockResolvedValueOnce({ error: 'Another invoice was issued at the same moment. Try again.' }).mockResolvedValue({ error: null, success: 'Invoice issued.', record: 'Invoice #9', href: '/x' });
    const dialog = await choose(user);
    await chooseOption(within(dialog).getByLabelText('Item 1'), 'labour');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await screen.findByRole('alert');
    const first = sent().issuanceKey;
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(sent().issuanceKey).toBe(first);
  });

  it('refuses to continue with a whole-number problem or an item outside the trading currency', async () => {
    const user = userEvent.setup();
    const dialog = await choose(user);
    await chooseOption(within(dialog).getByLabelText('Item 1'), 'consult');
    expect(within(dialog).getByText(/priced in another currency/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();
    await chooseOption(within(dialog).getByLabelText('Item 1'), 'labour');
    await user.clear(within(dialog).getByLabelText('Quantity'));
    await user.type(within(dialog).getByLabelText('Quantity'), '0');
    expect(within(dialog).getByText(/whole number from 1 to 1,000,000/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('from a Work item offers only that Work, never the catalog choice', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1)], items });
    render(<InvoiceDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    await settle();
    expect(screen.queryByRole('radio', { name: /A customer, from catalog items/ })).toBeNull();
  });
});

describe('Invoice documents', () => {
  it('previews a draft from the review step with the fields issuance would use, and issues nothing', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:draft-1');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1, 'callout')], items });
    finance.previewInvoiceDocument.mockResolvedValue({ pdf: btoa('%PDF-1.3 draft') });
    render(<InvoiceDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'New invoice' });
    await user.click(within(dialog).getByRole('button', { name: 'Preview document' }));
    expect(finance.previewInvoiceDocument).toHaveBeenCalledWith({ organizationId: 'org', workItemId: 'w1', issuedAt: '2026-10-25', dueAt: '' });
    const open = await within(dialog).findByRole('link', { name: /Open draft preview/ });
    expect(open).toHaveAttribute('href', 'blob:draft-1');
    expect(open).toHaveAttribute('target', '_blank');
    expect(within(dialog).getByRole('link', { name: 'Download draft' })).toHaveAttribute('download', 'draft-invoice.pdf');
    expect(within(dialog).getByText(/a draft with today’s branding/)).toBeVisible();
    expect(finance.financeMutation).not.toHaveBeenCalled();
    // Changing what would be issued discards the draft.
    await user.type(within(dialog).getByLabelText(/Due date/), '2026-11-24');
    expect(within(dialog).queryByRole('link', { name: /Open draft preview/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Preview document' })).toBeVisible();
  });

  it('shows a refused preview without leaving the review', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1, 'callout')], items });
    finance.previewInvoiceDocument.mockResolvedValue({ error: 'Your role cannot preview invoices.' });
    render(<InvoiceDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    await settle();
    await user.click(screen.getByRole('button', { name: 'Preview document' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot preview invoices.');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('says when an issued invoice’s PDF was not created, without undoing the issue', async () => {
    const user = userEvent.setup();
    finance.financeReview.mockResolvedValue({ work, invoice: null, lines: [line('l1', 'Emergency callout', 27500, 1, 'callout')], items });
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Invoice issued.', record: 'Invoice #8', href: '/organizations/org/finance/invoices?invoice=i8', documentError: 'The invoice PDF could not be drawn. Try again.' });
    render(<InvoiceDialog organizationId="org" workItemId="w1" today="2026-10-25" />);
    await user.click(screen.getByRole('button', { name: 'New invoice' }));
    await settle();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Issue invoice' }));
    expect(await screen.findByText(/Invoice #8 issued/)).toBeVisible();
    expect(screen.getByText(/The invoice is issued, but its PDF was not created: The invoice PDF could not be drawn/)).toBeVisible();
  });

  const row = { id: 'i1', source: 'work_item' as const, workItemId: 'w1', proposalId: null, number: 7, billedTo: 'North Shore Plumbing', customerId: 'c1', currency: 'CAD', issuedAt: '2026-10-01T00:00:00Z', dueAt: null, total: { totalMinor: 27500, currency: 'CAD' }, paidMinor: 0, outstandingMinor: 27500, settled: false, overdue: false };
  const inspector = (document: { available: boolean; mayCreate: boolean }, email: Parameters<typeof InvoiceInspector>[0]['email'] = { may: false, inboxOpen: true, senderProblem: null, sends: [] }) => render(<WorkspaceRailProvider><InvoiceInspector organizationId="org" row={row} invoice={{ ...invoice(), customerId: 'c1', proposalId: null }} timezone="America/Toronto" today="2026-10-25" closeHref="/organizations/org/finance/invoices" mayRecord={false} document={document} email={email} /><PagePanel /></WorkspaceRailProvider>);

  it('offers the stored PDF as a download from the invoice', async () => {
    inspector({ available: true, mayCreate: true });
    expect(await screen.findByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/organizations/org/finance/invoices/i1/document');
    expect(screen.queryByRole('button', { name: 'Create PDF' })).toBeNull();
  });

  it('creates a missing PDF on request, and offers a retry after a refusal', async () => {
    const user = userEvent.setup();
    finance.createInvoiceDocument.mockResolvedValueOnce({ error: 'The invoice document could not be stored. Try again.' }).mockResolvedValueOnce({ error: null });
    inspector({ available: false, mayCreate: true });
    expect(await screen.findByText('The PDF of invoice #7 has not been created.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Download PDF' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be stored');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(finance.createInvoiceDocument).toHaveBeenCalledWith('org', 'i1');
  });

  it('offers no creation to someone who may not issue invoices', async () => {
    inspector({ available: false, mayCreate: false });
    expect(await screen.findByText('The PDF of invoice #7 has not been created.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Create PDF/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download PDF' })).toBeNull();
  });
});

describe('emailing an issued invoice from its inspector', () => {
  const row = { id: 'i1', source: 'direct' as const, workItemId: null, proposalId: null, number: 7, billedTo: 'North Shore Plumbing', customerId: 'c1', currency: 'CAD', issuedAt: '2026-10-01T00:00:00Z', dueAt: null, total: { totalMinor: 27500, currency: 'CAD' }, paidMinor: 0, outstandingMinor: 27500, settled: false, overdue: false };
  const open = (email: Parameters<typeof InvoiceInspector>[0]['email']) => render(<WorkspaceRailProvider><InvoiceInspector organizationId="org" row={row} invoice={{ ...invoice(), customerId: 'c1', proposalId: null }} timezone="America/Toronto" today="2026-10-25" closeHref="/organizations/org/finance/invoices" mayRecord={false} document={{ available: true, mayCreate: true }} email={email} /><PagePanel /></WorkspaceRailProvider>);
  const draft = (preview: Partial<Record<string, unknown>> = {}) => ({ draft: {
    number: 7, customer: 'North Shore Plumbing', amount: 'CA$275.00', subject: 'Invoice #7 from Harbour Ltd', text: 'Hello North Shore Plumbing,',
    preview: { sender: { address: 'billing@harbour.example', name: 'Harbour' }, recipient: { address: 'ap@northshore.example', problem: null, customerId: 'c1', confirmedByCustomer: false },
      document: { fileName: 'invoice-7.pdf', sizeBytes: 3140 }, sentBefore: false, ...preview },
  } });
  const sent = (state: string, label: string, detail: string | null = null) => ({ id: `e-${state}`, conversationId: 'conv1', recipient: 'ap@northshore.example', fromAddress: 'billing@harbour.example', createdAt: '2026-10-25T15:00:00Z', sentAgain: false, state: state as never, label, detail });

  it('shows the sender, recipient, attached PDF and amount, and lets only the subject and message be written', async () => {
    const user = userEvent.setup();
    finance.invoiceEmailDraft.mockResolvedValue(draft());
    open({ may: true, inboxOpen: true, senderProblem: null, sends: [] });
    await user.click(await screen.findByRole('button', { name: 'Send invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send invoice' });
    for (const text of ['billing@harbour.example', 'ap@northshore.example', 'invoice-7.pdf', 'CA$275.00']) expect(await within(dialog).findByText(text, { exact: false })).toBeVisible();
    expect(within(dialog).getAllByRole('textbox').map(box => box.getAttribute('id'))).toEqual([expect.stringMatching(/subject$/), expect.stringMatching(/message$/)]);
  });

  it('submits the same key after a refusal, and calls an accepted email accepted, not delivered', async () => {
    const user = userEvent.setup();
    finance.invoiceEmailDraft.mockResolvedValue(draft());
    finance.sendInvoiceEmail.mockResolvedValueOnce({ error: 'Email could not be sent just now.', code: 'invoice_emails.failed' })
      .mockResolvedValueOnce({ outcome: { invoiceEmailId: 'e1', messageId: 'm1', conversationId: 'conv1', state: 'accepted', label: 'Accepted for delivery', detail: 'Not yet confirmed as delivered.' } });
    open({ may: true, inboxOpen: true, senderProblem: null, sends: [] });
    await user.click(await screen.findByRole('button', { name: 'Send invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send invoice' });
    await user.click(await within(dialog).findByRole('button', { name: 'Send invoice' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be sent');
    await user.click(within(dialog).getByRole('button', { name: 'Send invoice' }));
    expect(await within(dialog).findByText('Accepted for delivery')).toBeVisible();
    expect(within(dialog).queryByText(/^Delivered/)).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/organizations/org/comms/inbox/conv1');
    const [first, second] = finance.sendInvoiceEmail.mock.calls.map(call => call[0]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(first).toEqual({ organizationId: 'org', invoiceId: 'i1', recipient: 'ap@northshore.example', subject: 'Invoice #7 from Harbour Ltd', text: 'Hello North Shore Plumbing,', idempotencyKey: expect.any(String), sendAgain: false });
  });

  it('cannot be sent without an address, and says where to add one', async () => {
    const user = userEvent.setup();
    finance.invoiceEmailDraft.mockResolvedValue(draft({ recipient: { address: null, problem: 'The customer has no email address. Add one to their contact record first.', customerId: 'c1', confirmedByCustomer: false } }));
    open({ may: true, inboxOpen: true, senderProblem: null, sends: [] });
    await user.click(await screen.findByRole('button', { name: 'Send invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send invoice' });
    expect(await within(dialog).findByText(/no email address/)).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Open the contact record' })).toHaveAttribute('href', '/organizations/org/crm/contacts/c1');
    expect(within(dialog).getByRole('button', { name: 'Send invoice' })).toBeDisabled();
  });

  it('is unavailable with a reason and a way to Settings when the business cannot send', async () => {
    open({ may: true, inboxOpen: true, senderProblem: 'This business has no default sender address.', sends: [] });
    expect(await screen.findByRole('button', { name: 'Send invoice' })).toBeDisabled();
    expect(screen.getByText(/Invoices cannot be emailed yet. This business has no default sender address./)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Settings → Email' })).toHaveAttribute('href', '/organizations/org/settings/email');
  });

  it('offers no conversation link where this person cannot open the Inbox', async () => {
    open({ may: true, inboxOpen: false, senderProblem: null, sends: [sent('accepted', 'Accepted for delivery')] });
    expect(await screen.findByText(/Accepted for delivery/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open conversation' })).toBeNull();
  });

  it('is not offered to someone who may not email invoices', async () => {
    open({ may: false, inboxOpen: true, senderProblem: null, sends: [] });
    await screen.findByRole('link', { name: 'Download PDF' });
    expect(screen.queryByRole('button', { name: /Send invoice|Send again/ })).toBeNull();
  });

  it('lists each send with its own state, offers a retry only for one that has not left, and asks for Send again after one', async () => {
    open({ may: true, inboxOpen: true, senderProblem: null, sends: [sent('accepted', 'Accepted for delivery', 'Not yet confirmed as delivered.'), sent('not_sent', 'Not sent yet', 'Email could not be sent just now.')] });
    expect(await screen.findByText(/to ap@northshore.example: Accepted for delivery/)).toBeVisible();
    expect(screen.queryByText(/: Delivered/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try sending again' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send again' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Send invoice' })).toBeNull();
  });
});
