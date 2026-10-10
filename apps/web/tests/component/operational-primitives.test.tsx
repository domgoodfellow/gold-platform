// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipboardList } from 'lucide-react';
import { MetricTile, OperationalPanel, PanelState, StatePill, ViewNavigation } from '@/components/operational/primitives';

vi.mock('next/link', () => ({ default: ({ href, children, scroll: _scroll, ...rest }: Record<string, unknown>) => <a href={String(href)} {...rest}>{children as never}</a> }));
afterEach(cleanup);

describe('shared operational components', () => {
  it('MetricTile is a link only when it has a destination, and reads label before value', () => {
    const { rerender } = render(<MetricTile label="Open cases" value={4} detail="Current" icon={ClipboardList} href="/cases" />);
    expect(screen.getByRole('link', { name: /Open cases\s*4/ })).toHaveAttribute('href', '/cases');
    rerender(<MetricTile label="Open cases" value={4} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('MetricTile colours the value only for a platform-reported exception', () => {
    render(<MetricTile label="Overdue" value={2} emphasis="danger" />);
    expect(screen.getByText('2').className).toContain('text-danger');
  });

  it('StatePill states a tone with semantic roles, never a palette colour', () => {
    render(<><StatePill tone="success">ok</StatePill><StatePill tone="warning">hmm</StatePill><StatePill tone="danger">bad</StatePill><StatePill>plain</StatePill></>);
    for (const [text, role] of [['ok', 'success'], ['hmm', 'warning'], ['bad', 'danger'], ['plain', 'secondary']] as const) {
      expect(screen.getByText(text).className).toContain(role);
      expect(screen.getByText(text).className).not.toMatch(/\b(?:blue|rose|amber|emerald|slate)-\d/);
    }
  });

  it('PanelState says which kind of nothing it is; only an unavailable read announces itself as a status', () => {
    render(<><PanelState kind="empty">Nothing yet</PanelState><PanelState kind="unavailable">Could not read</PanelState><PanelState kind="restricted">Not for your role</PanelState><PanelState kind="not-configured">Set it up</PanelState></>);
    expect(screen.getByText('Nothing yet').closest('[data-state]')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByText('Could not read').closest('[data-state]')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Not for your role').closest('[data-state]')).toHaveAttribute('data-state', 'restricted');
    expect(screen.getByText('Set it up').closest('[data-state]')).toHaveAttribute('data-state', 'not-configured');
    expect(screen.getByText('Nothing yet').closest('[data-state]')).not.toHaveAttribute('role');
  });

  it('OperationalPanel is a named region with a count, a destination link and one h2', () => {
    render(<OperationalPanel title="Needs attention" count={3} href="/all">body</OperationalPanel>);
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/all');
  });

  it('ViewNavigation marks the current view with aria-current and more than colour', () => {
    render(<ViewNavigation label="Views" items={[{ key: 'a', label: 'One', href: '/a', current: true }, { key: 'b', label: 'Two', href: '/b', current: false }]} />);
    const current = screen.getByRole('link', { name: 'One' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.className).toMatch(/font-semibold/);
    expect(current.className).toMatch(/border-accent/);
    expect(screen.getByRole('link', { name: 'Two' })).not.toHaveAttribute('aria-current');
  });
});
