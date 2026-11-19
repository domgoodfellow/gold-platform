// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GettingStarted } from '@/features/finance/home/finance-home';

vi.mock('@/features/finance/transactions/quote-dialog', () => ({ QuoteDialog: ({ label }: { label: string }) => <button>{label}</button> }));
vi.mock('@/app/organizations/[organizationId]/finance/dashboard-actions', () => ({ saveFinanceDashboardLayout: vi.fn(), resetFinanceDashboardLayout: vi.fn() }));
afterEach(cleanup);

it('offers catalog setup only before pricing is configured', () => {
  const { rerender } = render(<GettingStarted organizationId="org" priced={false} mayManageCatalog mayQuote mayCreateWork />);
  expect(screen.getByRole('link', { name: 'Set up pricing' })).toHaveAttribute('href', '/organizations/org/finance/catalog');
  rerender(<GettingStarted organizationId="org" priced mayManageCatalog mayQuote mayCreateWork />);
  expect(screen.getByText(/Pricing configured/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'New quote' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Set up pricing' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Price Work' })).toBeNull();
});

it('offers the price book when the reader cannot quote or change prices', () => {
  render(<GettingStarted organizationId="org" priced mayManageCatalog={false} mayQuote={false} mayCreateWork={false} />);
  expect(screen.getByRole('link', { name: 'View price book' })).toHaveAttribute('href', '/organizations/org/finance/catalog');
  expect(screen.queryByRole('button')).toBeNull();
});
