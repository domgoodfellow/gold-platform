// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PricingPlanner } from '@/features/finance/pricing-planner';
import { chooseOption } from '../support/select-field';

afterEach(cleanup);
const items = [{ id: 'visit', name: 'Visit', unit: 'visit', unitAmountMinor: 14500, currency: 'CAD', createdAt: '' }, { id: 'usd', name: 'Consultation', unit: 'hour', unitAmountMinor: 10000, currency: 'USD', createdAt: '' }];
function fill(group: HTMLElement) {
  const scope = within(group);
  for (const [label, value] of [['Labor quantity (hours)', '2'], ['Labor cost per hour', '40'], ['Materials cost', '20'], ['Supplier cost', '10'], ['Other estimated cost', '10'], ['Target gross margin (%)', '25']]) fireEvent.change(scope.getByLabelText(label), { target: { value } });
  return scope;
}
describe('pricing planner interactions', () => {
  it('works with no catalog and keeps up to three alternatives independent', () => {
    render(<PricingPlanner currency="CAD" items={[]} />);
    expect(screen.getByText(/No catalog items yet/)).toBeVisible();
    const first = fill(screen.getByRole('group', { name: 'Scenario 1' }));
    expect(first.getByTestId('suggested-price')).toHaveTextContent('160.00');
    fireEvent.click(screen.getByRole('button', { name: 'Compare another scenario' }));
    const second = within(screen.getByRole('group', { name: 'Scenario 2' }));
    fireEvent.change(second.getByLabelText('Target gross margin (%)'), { target: { value: '40' } });
    expect(second.getByTestId('suggested-price')).toHaveTextContent('200.00');
    expect(first.getByTestId('suggested-price')).toHaveTextContent('160.00');
    fireEvent.click(screen.getByRole('button', { name: 'Compare another scenario' }));
    expect(screen.getByRole('button', { name: 'Compare another scenario' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove scenario 2' }));
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });
  it('keeps catalog values unchanged and refuses foreign-currency comparisons', async () => {
    const before = structuredClone(items);
    render(<PricingPlanner currency="CAD" items={items} />);
    const scope = fill(screen.getByRole('group', { name: 'Scenario 1' }));
    await chooseOption(scope.getByLabelText('Compare one catalog unit'), 'visit');
    expect(scope.getByText(/Current catalog:/)).toHaveTextContent('145.00');
    await chooseOption(scope.getByLabelText('Compare one catalog unit'), 'usd');
    expect(scope.getByText(/Different currencies/)).toBeVisible();
    await chooseOption(scope.getByLabelText('Currency'), 'JPY');
    expect(scope.getByLabelText('Materials cost')).toHaveValue('');
    expect(scope.getByTestId('suggested-price')).toHaveTextContent('Unknown');
    expect(items).toEqual(before);
  });
  it('requires documentation for zero assumptions and reveals invalid input', async () => {
    render(<PricingPlanner currency={null} items={[]} />);
    const group = screen.getByRole('group', { name: 'Scenario 1' });
    const scope = within(group);
    await chooseOption(scope.getByLabelText('Currency'), 'CAD');
    fill(group);
    fireEvent.change(scope.getByLabelText('Materials cost'), { target: { value: '0' } });
    expect(scope.getByText(/Explain each zero-cost/)).toBeVisible();
    fireEvent.change(scope.getByLabelText('Zero-cost assumptions'), { target: { value: 'No materials needed.' } });
    expect(scope.getByTestId('suggested-price')).toHaveTextContent('133.34');
    fireEvent.change(scope.getByLabelText('Target gross margin (%)'), { target: { value: '100' } });
    expect(scope.getByLabelText('Target gross margin (%)')).toHaveAttribute('aria-invalid', 'true');
    expect(scope.getByTestId('suggested-price')).toHaveTextContent('Unknown');
  });
});
