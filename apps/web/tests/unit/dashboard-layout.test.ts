import { describe, expect, it } from 'vitest';
import {
  arrange, canonicalLayout, defaultLayout, layoutProblems, modeSpan, moveWidget, normalizeLayout, packRows, resizeWidget, sameLayout, setWidgetOption, stepWidget, stepWidth, visibleWidgets,
} from '@/lib/dashboard-layout';
import { FINANCE_WIDGETS, readableFinanceWidgets } from '@/lib/application/finance/dashboard-widgets';

const registry = FINANCE_WIDGETS;
const all = new Set<string>(registry.map(widget => widget.id));

describe('the Finance default composition', () => {
  it('keeps the approved reading order and fills each wide row without a gap', () => {
    const layout = defaultLayout(registry);
    expect(layout.widgets.map(widget => widget.id)).toEqual(['overview', 'attention', 'payments-trend', 'aging', 'activity', 'performance', 'invoice-status']);
    expect(packRows(layout.widgets, 12)).toEqual([
      { id: 'overview', span: 12, row: 0 },
      { id: 'attention', span: 4, row: 1 }, { id: 'payments-trend', span: 8, row: 1 },
      { id: 'aging', span: 6, row: 2 }, { id: 'activity', span: 6, row: 2 },
      { id: 'performance', span: 6, row: 3 }, { id: 'invoice-status', span: 6, row: 3 },
    ]);
  });

  it('halves or fills at intermediate width, keeps dense charts full, and is one column on a phone', () => {
    const spans = arrange(registry, defaultLayout(registry).widgets);
    expect(Object.fromEntries(spans.medium)).toEqual({ overview: 6, attention: 6, 'payments-trend': 6, aging: 3, activity: 3, performance: 6, 'invoice-status': 6 });
    expect([...spans.narrow.values()].every(span => span === 1)).toBe(true);
    expect(modeSpan(registry[1], 4, 'medium')).toBe(3);
  });

  it('closes the space a viewer without reporting access cannot fill', () => {
    const readable = readableFinanceWidgets({ billingEnabled: true, capabilities: [] });
    const shown = visibleWidgets(defaultLayout(registry), readable);
    expect(shown.map(widget => widget.id)).toEqual(['overview', 'attention', 'activity', 'invoice-status']);
    // Activity moves up beside attention and widens to close the row; nothing is left empty.
    expect(Object.fromEntries(arrange(registry, shown).wide)).toEqual({ overview: 12, attention: 4, activity: 8, 'invoice-status': 12 });
    expect(readableFinanceWidgets({ billingEnabled: false, capabilities: ['report.read'] }).size).toBe(0);
  });
});

describe('editing', () => {
  it('resizes by pointer or button to the same allowed spans', () => {
    const layout = defaultLayout(registry);
    const byPointer = resizeWidget(layout, registry, 'aging', 7.6);
    const byButton = stepWidth(layout, registry, 'aging', 1);
    expect(byPointer.widgets.find(widget => widget.id === 'aging')!.span).toBe(8);
    expect(byButton.widgets.find(widget => widget.id === 'aging')!.span).toBe(8);
    expect(resizeWidget(layout, registry, 'aging', 1).widgets.find(widget => widget.id === 'aging')!.span).toBe(4);
    expect(resizeWidget(layout, registry, 'overview', 4).widgets[0].span).toBe(12);
    expect(stepWidth(layout, registry, 'overview', -1)).toEqual(layout);
  });

  it('moves among visible widgets only, never past the ends', () => {
    const layout = setWidgetOption(defaultLayout(registry), registry, 'aging', { hidden: true });
    const visible = new Set(visibleWidgets(layout, all).map(widget => widget.id));
    const moved = stepWidget(layout, 'activity', -1, visible);
    expect(visibleWidgets(moved, all).map(widget => widget.id)).toEqual(['overview', 'attention', 'activity', 'payments-trend', 'performance', 'invoice-status']);
    expect(stepWidget(layout, 'overview', -1, visible)).toBe(layout);
    expect(moveWidget(layout, 'invoice-status', 0).widgets[0].id).toBe('invoice-status');
  });

  it('refuses options a widget does not allow: hiding core widgets, invalid presentations, unknown heights', () => {
    const layout = defaultLayout(registry);
    expect(setWidgetOption(layout, registry, 'overview', { hidden: true })).toEqual(layout);
    expect(setWidgetOption(layout, registry, 'payments-trend', { presentation: 'donut' })).toEqual(layout);
    expect(setWidgetOption(layout, registry, 'aging', { presentation: 'bar' })).toEqual(layout);
    expect(setWidgetOption(layout, registry, 'payments-trend', { presentation: 'bar' }).widgets[2].presentation).toBe('bar');
  });

  it('compares layouts by content, not key order', () => {
    const layout = defaultLayout(registry);
    const reordered = { version: 1 as const, widgets: layout.widgets.map(widget => Object.fromEntries(Object.entries(widget).reverse())) as typeof layout.widgets };
    expect(sameLayout(layout, reordered)).toBe(true);
    expect(sameLayout(layout, stepWidth(layout, registry, 'aging', 1))).toBe(false);
  });
});

describe('saving and loading', () => {
  it('accepts a complete valid layout and refuses anything else, strictly', () => {
    expect(layoutProblems(registry, canonicalLayout(defaultLayout(registry)))).toEqual([]);
    const base = canonicalLayout(defaultLayout(registry));
    const broken = (change: (layout: { version: number; widgets: Record<string, unknown>[] }) => void) => { const copy = JSON.parse(JSON.stringify(base)); change(copy); return layoutProblems(registry, copy); };
    expect(broken(l => { l.widgets.push({ id: 'saved-report:123', span: 6, height: 'standard' }); })).toContain('Unsupported widget.');
    expect(broken(l => { l.widgets[2].span = 5; })).toContain('Payments received cannot be that wide.');
    expect(broken(l => { l.widgets[2].presentation = 'donut'; })).toContain('Payments received cannot be shown that way.');
    expect(broken(l => { l.widgets[0].hidden = true; })).toContain('Financial overview cannot be hidden.');
    expect(broken(l => { l.widgets.pop(); })).toContain('Invoices by status is missing.');
    expect(broken(l => { l.widgets.push({ ...l.widgets[1] }); })).toContain('Needs attention appears twice.');
    expect(broken(l => { l.version = 2; })).toContain('Unsupported layout version.');
    expect(broken(l => { (l.widgets[1] as Record<string, unknown>).query = 'select *'; })).toContain('Needs attention has unknown settings.');
    expect(layoutProblems(registry, 'not a layout')).toEqual(['Layout is not an object.']);
  });

  it('reads an old or damaged layout as the nearest valid one, adding new widgets in their default place', () => {
    const stored = { version: 1, widgets: [
      { id: 'payments-trend', span: 12, height: 'tall', presentation: 'bar' }, { id: 'retired-widget', span: 6, height: 'standard' },
      { id: 'overview', span: 12, height: 'standard' }, { id: 'aging', span: 5, height: 'huge', hidden: true },
    ] };
    const layout = normalizeLayout(registry, stored);
    expect(layout.widgets.map(widget => widget.id)).toEqual(['payments-trend', 'overview', 'attention', 'aging', 'activity', 'performance', 'invoice-status']);
    expect(layout.widgets.find(widget => widget.id === 'payments-trend')).toMatchObject({ span: 12, height: 'tall', presentation: 'bar' });
    expect(layout.widgets.find(widget => widget.id === 'aging')).toMatchObject({ span: 6, height: 'standard', hidden: true });
    expect(layoutProblems(registry, canonicalLayout(layout))).toEqual([]);
    expect(normalizeLayout(registry, { version: 9 })).toEqual(defaultLayout(registry));
  });

  it('never packs widgets into overlapping or gapped rows, whatever the order and widths', () => {
    const spans = [3, 4, 6, 8, 12];
    for (let seed = 0; seed < 200; seed++) {
      const widgets = Array.from({ length: 7 }, (_, index) => ({ id: String(index), span: spans[(seed * 7 + index * 3) % spans.length] }));
      const rows = new Map<number, number>();
      for (const placed of packRows(widgets, 12)) rows.set(placed.row, (rows.get(placed.row) ?? 0) + placed.span);
      expect([...rows.values()].every(total => total === 12)).toBe(true);
    }
  });
});
