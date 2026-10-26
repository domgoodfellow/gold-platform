// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_FIXTURES } from '@/components/charts/chart-fixtures';

/**
 * The shared chart family, rendered. Every presentation must show the same values as its table,
 * read by keyboard without trapping focus, keep negative and unknown values truthful, and fit a
 * narrow container. jsdom has no layout, so the measured size is set per test.
 */
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const { Chart, ChartDataTable } = await import('@/components/charts/charts');

let size = { width: 640, height: 224 };
beforeEach(() => {
  router.push.mockReset();
  size = { width: 640, height: 224 };
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => size.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => size.height });
  HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cells = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent));
const plotSvg = (container: HTMLElement) => container.querySelector('[aria-roledescription="chart"] svg');

describe('every presentation shows the same values', () => {
  it('draws payments as a line, offers bar and table, and the table lists exactly the supplied labels', async () => {
    const user = userEvent.setup();
    const { data, title } = CHART_FIXTURES.paymentsWithCorrections;
    render(<Chart title={title} data={data} />);
    const select = screen.getByLabelText(`${title} presentation`);
    expect([...select.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Line', 'Vertical bars', 'Table']);
    expect(screen.getByText('October 2026 · CAD')).toBeVisible();
    await user.selectOptions(select, 'table');
    expect(cells(screen.getByRole('table'))).toEqual([['Oct 1', 'CA$420.50'], ['Oct 2', 'CA$0.00'], ['Oct 9', '-CA$25.00'], ['Oct 20', 'CA$1,200.00'], ['Oct 24', 'CA$229.50']]);
    // A negative correction is marked, not hidden; zero stays a value.
    expect(within(screen.getByRole('table')).getByText('-CA$25.00')).toHaveClass('text-danger');
  });

  it('keeps an unknown cost unknown in the table and in the bars (no bar is drawn for it)', () => {
    const { data, title } = CHART_FIXTURES.financialsUnknown;
    const { container } = render(<Chart title={title} data={data} />);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Costs recorded');
    // Three invoiced bars plus two known costs.
    expect(container.querySelectorAll('[aria-roledescription="chart"] svg > rect:not([opacity="0.05"])').length).toBe(5);
    // The second series is hatched as well as tinted, so it never differs by colour alone.
    expect(container.querySelectorAll('[aria-roledescription="chart"] svg > rect[fill^="url(#"]').length).toBe(2);
    // Written where the bar would start, so it cannot be mistaken for a recorded zero.
    expect([...plotSvg(container)!.querySelectorAll('text')].some(text => text.textContent === 'Unknown')).toBe(true);
    fireEvent.click(screen.getByText('View as table'));
    expect(cells(screen.getByRole('table'))[1]).toEqual(['Maple Dental', 'CA$443.00', 'Unknown']);
  });

  it('offers the donut only for parts of one whole', () => {
    render(<Chart title="Invoices by status" data={CHART_FIXTURES.invoiceStatus.data} />);
    expect([...screen.getByLabelText('Invoices by status presentation').querySelectorAll('option')].map(o => o.value)).toEqual(['stacked-bar', 'donut', 'table']);
    cleanup();
    render(<Chart title="Receivables aging" data={CHART_FIXTURES.agingLongLabels.data} />);
    expect([...screen.getByLabelText('Receivables aging presentation').querySelectorAll('option')].map(o => o.value)).toEqual(['horizontal-bar', 'bar', 'table']);
  });

  it('stacks a single-series composition as one bar of parts, each part labelled with its exact value', () => {
    render(<Chart title="Invoices by status" data={CHART_FIXTURES.invoiceStatus.data} />);
    expect(screen.getByRole('img', { name: 'Invoices by status: Overdue 2, Outstanding, not overdue 3, Settled 1' })).toBeInTheDocument();
    expect(document.querySelector('[aria-roledescription="chart"]')).toBeNull();
  });

  it('shows an empty state with no sample values and no presentation menu', () => {
    render(<Chart title="Payments received" data={CHART_FIXTURES.empty.data} />);
    expect(screen.getByText('Nothing recorded for this period.')).toBeVisible();
    expect(screen.queryByLabelText('Payments received presentation')).toBeNull();
    expect(document.querySelector('[aria-roledescription="chart"]')).toBeNull();
  });

  it('says loading and unavailable as different states', () => {
    render(<Chart title="A" data={CHART_FIXTURES.singlePoint.data} state={{ status: 'loading' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    cleanup();
    render(<Chart title="A" data={CHART_FIXTURES.singlePoint.data} state={{ status: 'unavailable', message: 'Payments could not be read.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Payments could not be read.');
  });
});

describe('reading a chart without a pointer', () => {
  it('is one focus stop: arrows announce exact values, Escape hides the tooltip and focus stays', async () => {
    const user = userEvent.setup();
    const { data, title } = CHART_FIXTURES.paymentsWithCorrections;
    render(<><button>before</button><Chart title={title} data={data} /><button>after</button></>);
    await user.click(screen.getByText('before'));
    await user.tab();
    expect(screen.getByLabelText(`${title} presentation`)).toHaveFocus();
    await user.tab();
    const plot = screen.getByRole('group', { name: /Payments received/ });
    expect(plot).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.getElementById(plot.getAttribute('aria-describedby')!)).toHaveTextContent('Oct 9: -CA$25.00');
    await user.keyboard('{Escape}');
    expect(plot).toHaveFocus();
    expect(document.getElementById(plot.getAttribute('aria-describedby')!)).toHaveTextContent('');
    await user.tab();
    expect(screen.getByText('View as table')).toHaveFocus();
  });

  it('opens a category’s authorized destination with Enter, and the table links it', async () => {
    const user = userEvent.setup();
    const data = { ...CHART_FIXTURES.agingLongLabels.data, categories: CHART_FIXTURES.agingLongLabels.data.categories.map(c => ({ ...c, href: `/invoices?age=${c.key}` })) };
    render(<Chart title="Receivables aging" data={data} />);
    screen.getByRole('group', { name: /Receivables aging/ }).focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(router.push).toHaveBeenCalledWith('/invoices?age=1-30');
    fireEvent.click(screen.getByText('View as table'));
    expect(within(screen.getByRole('table')).getByRole('link', { name: '31–60 days past due' })).toHaveAttribute('href', '/invoices?age=31-60');
  });
});

describe('fitting the space and the theme', () => {
  it('fits a 240px container: the drawing is as wide as its container and long labels are shortened', () => {
    size = { width: 240, height: 160 };
    const { container } = render(<Chart title="Receivables aging" data={CHART_FIXTURES.agingLongLabels.data} height="compact" />);
    expect(plotSvg(container)).toHaveAttribute('width', '240');
    const labels = [...plotSvg(container)!.querySelectorAll('text')].map(text => text.textContent ?? '');
    expect(labels.some(label => label.endsWith('…'))).toBe(true);
    expect(labels.every(label => label.length <= 40)).toBe(true);
  });

  it('draws a single point as a marker and spaces sparse dates by time', () => {
    const { container, rerender } = render(<Chart title="Payments received" data={CHART_FIXTURES.singlePoint.data} />);
    expect(plotSvg(container)!.querySelectorAll('circle').length).toBe(1);
    rerender(<Chart title="Payments received" data={CHART_FIXTURES.paymentsWithCorrections.data} />);
    const xs = [...plotSvg(container)!.querySelectorAll('circle')].map(circle => Number(circle.getAttribute('cx')));
    // Oct 1 → Oct 2 is one day; Oct 9 → Oct 20 is eleven: gaps follow the calendar, not the row count.
    expect((xs[3] - xs[2]) / (xs[1] - xs[0])).toBeCloseTo(11, 0);
  });

  it('uses theme tokens only, so light, dark and the organization palette apply', () => {
    const { container } = render(<Chart title="Financials" data={CHART_FIXTURES.financialsUnknown.data} />);
    const colours = [...container.querySelectorAll('[aria-roledescription="chart"] svg [fill], [aria-roledescription="chart"] svg [stroke]')].flatMap(node => [node.getAttribute('fill'), node.getAttribute('stroke')]).filter(Boolean) as string[];
    expect(colours.filter(colour => !/^(var\(|currentColor|none|url\(#)/.test(colour))).toEqual([]);
  });

  it('keeps the table caption naming the period and currency', () => {
    render(<ChartDataTable title="Payments received" data={CHART_FIXTURES.paymentsUsd.data} />);
    expect(screen.getByRole('table', { name: 'Payments received, October 2026, USD' })).toBeInTheDocument();
  });
});

void act;
