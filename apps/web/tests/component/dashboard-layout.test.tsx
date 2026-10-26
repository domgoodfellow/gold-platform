// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLayout, type DashboardLayout } from '@/lib/dashboard-layout';
import { FINANCE_WIDGETS } from '@/lib/application/finance/dashboard-widgets';

/**
 * The shared Dashboard layout editor, driven as a person would: nothing moves until Customize;
 * width, height, hiding and order change only the draft; Cancel discards it; Save sends one complete
 * canonical layout and shows a refusal or a conflict as it came back; Reset returns to the default;
 * a phone-width dashboard offers no drag or resize handles; a widget the viewer may not read is
 * never rendered, whatever the layout says.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { CustomizeDashboardButton, DashboardEditingProvider, DashboardLayoutGrid } = await import('@/components/dashboard/dashboard-layout');

let width = 1200;
beforeEach(() => {
  width = 1200;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const all = FINANCE_WIDGETS.map(widget => widget.id);
const nodes = Object.fromEntries(all.map(id => [id, { kind: 'node' as const, node: <p>{id} content</p> }]));
function renderEditor({ readable = all, saved = { layout: defaultLayout(FINANCE_WIDGETS), revision: 0, customized: false }, onSave = vi.fn(async (_layout: DashboardLayout, revision: number) => ({ revision: revision + 1 })), onReset = vi.fn(async () => ({})) } = {}) {
  render(<DashboardEditingProvider available><CustomizeDashboardButton /><DashboardLayoutGrid label="Finance dashboard" registry={FINANCE_WIDGETS} saved={saved} readable={readable} widgets={nodes} onSave={onSave} onReset={onReset} /></DashboardEditingProvider>);
  return { onSave, onReset };
}
const span = (id: string) => document.querySelector(`[data-widget-id="${id}"]`)?.getAttribute('data-span');
const order = () => [...document.querySelectorAll<HTMLElement>('[data-widget-id]')].map(node => node.dataset.widgetId);

describe('customizing a Dashboard', () => {
  it('shows no editing controls until Customize, and Cancel discards every change', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    expect(screen.queryByRole('toolbar', { name: 'Customize dashboard' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Resize / })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    expect(screen.getByRole('toolbar', { name: 'Customize dashboard' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Increase width of Receivables aging' }));
    await user.click(screen.getByRole('button', { name: 'Hide Invoices by status' }));
    await user.click(screen.getByRole('button', { name: 'Move Financial activity earlier' }));
    expect(span('aging')).toBe('8');
    expect(document.querySelector('[data-widget-id="invoice-status"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('toolbar', { name: 'Customize dashboard' })).toBeNull();
    expect(span('aging')).toBe('6');
    expect(order()).toEqual(all);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('resizes with the keyboard on the handle and with the width buttons, within the allowed spans', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    const handle = screen.getByRole('button', { name: /^Resize Receivables aging/ });
    handle.focus();
    await user.keyboard('{ArrowRight}');
    expect(span('aging')).toBe('8');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(span('aging')).toBe('12');
    expect(screen.getByRole('button', { name: 'Increase width of Receivables aging' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Decrease width of Receivables aging' }));
    expect(span('aging')).toBe('8');
    // A widget with one width offers no width controls and no handle.
    expect(screen.queryByRole('button', { name: /^Resize Financial overview/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide Financial overview' })).toBeNull();
  });

  it('restores a hidden widget, saves one complete layout, and leaves edit mode', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Hide Receivables aging' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Customize dashboard' });
    await user.click(within(toolbar).getByRole('button', { name: 'Show Receivables aging' }));
    await user.click(screen.getByRole('button', { name: 'Hide Invoices by status' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [layout, revision] = onSave.mock.calls[0];
    expect(revision).toBe(0);
    expect(layout.widgets.map(widget => widget.id)).toEqual(all);
    expect(layout.widgets.find(widget => widget.id === 'invoice-status')).toMatchObject({ hidden: true });
    expect(layout.widgets.find(widget => widget.id === 'aging')!.hidden).toBeUndefined();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dashboard layout saved.'));
    expect(screen.queryByRole('toolbar', { name: 'Customize dashboard' })).toBeNull();
  });

  it('keeps editing and shows the reason when a save is refused, and offers Reload on a conflict', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValueOnce({ error: 'This layout cannot be saved: Receivables aging cannot be that wide.' }).mockResolvedValueOnce({ error: 'This dashboard was changed in another window.', conflict: true });
    renderEditor({ onSave });
    await user.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Increase width of Receivables aging' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be that wide');
    expect(screen.getByRole('toolbar', { name: 'Customize dashboard' })).toBeVisible();
    expect(span('aging')).toBe('8');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeVisible();
  });

  it('resets to the approved default by removing the saved layout', async () => {
    const user = userEvent.setup();
    const custom = { ...defaultLayout(FINANCE_WIDGETS), widgets: [...defaultLayout(FINANCE_WIDGETS).widgets].reverse().map(widget => widget.id === 'aging' ? { ...widget, span: 12 as const } : widget) };
    const { onReset } = renderEditor({ saved: { layout: custom, revision: 3, customized: true } });
    expect(order()[0]).toBe('invoice-status');
    await user.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(order()).toEqual(all));
    expect(span('aging')).toBe('6');
  });

  it('offers reordering but no drag or resize handles on a phone-width dashboard', async () => {
    width = 380;
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    expect(screen.getByRole('toolbar', { name: 'Customize dashboard' })).toHaveTextContent('every widget is full width');
    expect(screen.queryByRole('button', { name: /^Resize / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Drag to move/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Increase width/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Move Financial activity earlier' }));
    expect(order().indexOf('activity')).toBeLessThan(order().indexOf('aging'));
  });

  it('never renders a widget the viewer may not read, even when the saved layout includes it', () => {
    renderEditor({ readable: ['overview', 'attention', 'activity', 'invoice-status'] });
    expect(screen.queryByText('payments-trend content')).toBeNull();
    expect(screen.queryByText('aging content')).toBeNull();
    expect(order()).toEqual(['overview', 'attention', 'activity', 'invoice-status']);
  });
});
