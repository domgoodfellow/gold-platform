// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommercialProposal } from '@/lib/domain/customers/commercial-proposals';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';

vi.mock('@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions', () => ({
  buildCommercialProposalAction: vi.fn(async () => ({ error: null, created: true })),
  sendCommercialProposalAction: vi.fn(async () => ({ error: null })),
  sendProposalInviteAction: vi.fn(async () => ({ error: null, url: null })),
  handoffProposalAction: vi.fn(async () => ({ error: null, createdOrganizationId: null })),
}));

const finance = vi.hoisted(() => ({ financeChoices: vi.fn(), financeReview: vi.fn(), financePaymentReview: vi.fn(), financeDirectInvoiceReview: vi.fn(), financeMutation: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/finance/actions', () => finance);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/organizations/org/crm/contacts/customer' }));

import { CommercialProposalSection } from '@/features/crm/customers/commercial-proposal-section';

afterEach(cleanup);

const base: CommercialProposal = {
  id: 'p', organizationId: 'org', customerId: 'customer', basis: 'catalog', planId: null, planLabel: null,
  currency: 'CAD', billingInterval: 'one_time', planPriceMinor: 0, addonPriceMinor: 0, discountMinor: 0, discountReason: null,
  notes: '', status: 'draft', version: 1, supersedesId: null, createdAt: '2026-11-01T12:00:00Z', createdBy: 'u',
  acceptedBy: null, acceptedAt: null, acceptedConfiguration: null, proposedConfiguration: null, declinedBy: null, declinedAt: null,
  addons: [], catalogTotalMinor: 0, lines: [],
};

const catalog: CommercialProposal = {
  ...base, id: 'catalog', version: 2, status: 'accepted', acceptedBy: 'v', acceptedAt: '2026-11-01T13:00:00Z', catalogTotalMinor: 43_500,
  lines: [
    { position: 1, priceBookItemId: 'i1', name: 'Garden design', unit: 'hour', currency: 'CAD', quantity: 3, unitAmountMinor: 12_000, amountMinor: 36_000 },
    { position: 2, priceBookItemId: 'i2', name: 'Site visit', unit: 'visit', currency: 'CAD', quantity: 1, unitAmountMinor: 7_500, amountMinor: 7_500 },
  ],
};

const legacy: CommercialProposal = {
  ...base, id: 'legacy', basis: 'platform_plan', planId: 'plan', planLabel: 'Start', billingInterval: 'month', status: 'accepted',
  acceptedBy: 'v', acceptedAt: '2026-10-01T13:00:00Z', planPriceMinor: 49_900, addonPriceMinor: 3_500, catalogTotalMinor: null,
  addons: [{ addonPlanId: 'a', label: 'Additional user', priceMinor: 3_500 }],
};

const items: PriceBookItem[] = [
  { id: 'i1', name: 'Garden design', unit: 'hour', unitAmountMinor: 12_000, currency: 'CAD', createdAt: '' } as PriceBookItem,
  { id: 'usd', name: 'Imported plant', unit: 'each', unitAmountMinor: 900, currency: 'USD', createdAt: '' } as PriceBookItem,
];

function renderSection(overrides: Partial<Parameters<typeof CommercialProposalSection>[0]> = {}) {
  return render(
    <CommercialProposalSection
      organizationId="org" customerId="customer" proposals={[catalog, legacy]} invites={[]} handoffsByProposalId={{}}
      mayHandoff origin="http://localhost" catalogItems={items} mayBuild mayEdit role="Owner" currency="CAD"
      {...overrides}
    />,
  );
}

describe('commercial proposal section', () => {
  it('shows a catalog version as its copied lines and a legacy version as its plan, in one history', () => {
    renderSection();
    expect(screen.getByText('Garden design — 3 hour × CA$120.00 = CA$360.00')).toBeVisible();
    expect(screen.getByText('Total: CA$435.00, one-off')).toBeVisible();
    expect(screen.getByText('Start — CA$499.00/month')).toBeVisible();
    expect(screen.getByText('Additional user — CA$35.00/month')).toBeVisible();
    expect(screen.getAllByText(/Nothing has been invoiced or charged/)).toHaveLength(2);
  });

  it('offers the GildOps hand-off only on an accepted Platform Plan version', () => {
    renderSection();
    expect(screen.getAllByRole('button', { name: 'Create this business in GildOps' })).toHaveLength(1);
    renderSection({ proposals: [catalog], mayHandoff: true });
    expect(screen.getAllByRole('button', { name: 'Create this business in GildOps' })).toHaveLength(1);
  });

  it('builds from catalog items in the business currency, sending items and quantities but no price', async () => {
    const user = userEvent.setup();
    const { container } = renderSection({ proposals: [] });
    const item = screen.getByLabelText('Item 1');
    expect(within(item).queryByRole('option', { name: /Imported plant/ })).toBeNull();
    await user.selectOptions(item, 'i1');
    await user.clear(screen.getByLabelText('Quantity 1'));
    await user.type(screen.getByLabelText('Quantity 1'), '4');
    expect(screen.getByText(/Total at today’s catalog prices: CA\$480\.00/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    expect(screen.getByLabelText('Item 2')).toBeVisible();

    const form = container.querySelector('form:has(select[name="priceBookItemId"])') as HTMLFormElement;
    const names = [...new FormData(form).keys()];
    expect(new Set(names)).toEqual(new Set(['organizationId', 'customerId', 'priceBookItemId', 'quantity', 'notes']));
  });

  it('points to Catalog & Pricing when nothing is sellable, and offers no builder without permission', () => {
    renderSection({ proposals: [], catalogItems: [items[1]] });
    expect(screen.getByText(/Add an item priced in CAD to Catalog & Pricing/)).toBeVisible();
    cleanup();
    renderSection({ proposals: [], mayBuild: false, mayEdit: false, role: 'Viewer' });
    expect(screen.queryByRole('button', { name: 'Build proposal' })).toBeNull();
    expect(screen.getByText('Your role, Viewer, cannot build a commercial proposal.')).toBeVisible();
  });

  it('offers Create invoice only on an accepted catalog version, and only to someone who may invoice', () => {
    renderSection({ invoicing: { today: '2026-11-02', customerName: 'Vertex HVAC' } });
    expect(screen.getAllByRole('button', { name: /^Create invoice/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Create invoice from version 2' })).toBeVisible();
    cleanup();
    renderSection({ invoicing: null });
    expect(screen.queryByRole('button', { name: /^Create invoice/ })).toBeNull();
  });

  it('replaces Create invoice with View invoice once the version is invoiced', () => {
    renderSection({ invoicing: { today: '2026-11-02', customerName: 'Vertex HVAC' }, invoicesByProposalId: { catalog: { id: 'inv', number: 7 } } });
    expect(screen.queryByRole('button', { name: /^Create invoice/ })).toBeNull();
    expect(screen.getByText('Invoiced as #7.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View invoice' })).toHaveAttribute('href', '/organizations/org/finance/invoices?invoice=inv');
    // The legacy version still says nothing was invoiced; the invoiced one no longer does.
    expect(screen.getAllByText(/Nothing has been invoiced or charged/)).toHaveLength(1);
  });

  it('invoices the accepted lines as fixed, sending the proposal and dates but no line or price', async () => {
    const user = userEvent.setup();
    finance.financeMutation.mockResolvedValue({ error: null, success: 'Invoice issued.', record: 'Invoice #8', href: '/organizations/org/finance/invoices?invoice=inv' });
    renderSection({ invoicing: { today: '2026-11-02', customerName: 'Vertex HVAC' } });
    await user.click(screen.getByRole('button', { name: 'Create invoice from version 2' }));
    const dialog = screen.getByRole('dialog', { name: 'New invoice' });
    expect(within(dialog).getByLabelText('Invoice total')).toHaveTextContent('CA$435.00');
    expect(within(dialog).getByText(/Garden design/)).toBeVisible();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByRole('spinbutton')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(finance.financeMutation).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    const sent = Object.fromEntries((finance.financeMutation.mock.calls.at(-1)![1] as FormData).entries());
    expect(sent).toEqual({ organizationId: 'org', kind: 'invoice', source: 'proposal', proposalId: 'catalog', issuanceKey: expect.any(String), issuedAt: '2026-11-02', dueAt: '', confirmed: '1' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Invoice #8 issued'));
  });
});
