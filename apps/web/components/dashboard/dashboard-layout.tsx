'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, EyeOff, GripVertical, LayoutGrid, MoveHorizontal } from 'lucide-react';
import { Button } from '../controls/button';
import { SelectInput } from '../controls/inputs';
import { useUnsavedChanges } from '../controls/use-unsaved-changes';
import { cx, FOCUS_RING } from '../class-names';
import { Chart } from '../charts/charts';
import type { ChartData, ChartState } from '@/lib/chart-model';
import {
  arrange, canonicalLayout, defaultLayout, HEIGHT_LABEL, moveWidget, resizeWidget, sameLayout, setWidgetOption, SPAN_LABEL, stepWidget, stepWidth, visibleWidgets,
  type DashboardLayout, type WidgetDefinition, type WidgetDensity, type WidgetHeight, type WidgetPlacement, type WidgetSpan,
} from '@/lib/dashboard-layout';

/** What a widget draws. A chart widget is drawn here so its presentation follows the layout live; other widgets arrive rendered by the server. */
export type DashboardWidgetContent =
  | { kind: 'node'; node: ReactNode; densities?: Partial<Record<WidgetDensity, ReactNode>> }
  | { kind: 'chart'; title: string; variants: { key: string; label: string; data: ChartData }[]; state?: ChartState; footer?: ReactNode };

export type SaveLayoutResult = { revision: number; error?: undefined } | { error: string; conflict?: boolean };
type Saved = { layout: DashboardLayout; revision: number; customized: boolean };
type Editing = {
  editing: boolean; start: () => void; available: boolean;
};
const EditingContext = createContext<Editing | null>(null);

/**
 * Holds whether the Dashboard is being customized, so the header's Customize control and the grid
 * in the page body share one state. Wraps the whole Dashboard page.
 */
export function DashboardEditingProvider({ children, available }: { children: ReactNode; available: boolean }) {
  const [editing, setEditing] = useState(false);
  return <EditingContext.Provider value={{ editing, start: () => setEditing(true), available }}><StopContext.Provider value={() => setEditing(false)}>{children}</StopContext.Provider></EditingContext.Provider>;
}
const StopContext = createContext<() => void>(() => {});

/** Whether customizing is available, and how to start it — for a menu that offers it on narrow screens. */
export function useDashboardEditing() {
  return useContext(EditingContext);
}

/** The header control. Absent when there is nothing this person could arrange. `className` lets a header hide it where a menu offers it instead. */
export function CustomizeDashboardButton({ className }: { className?: string }) {
  const context = useContext(EditingContext);
  if (!context?.available) return null;
  return <Button type="button" tone="secondary" size="small" className={className} aria-pressed={context.editing} disabled={context.editing} onClick={context.start}><LayoutGrid aria-hidden className="size-4" />Customize dashboard</Button>;
}

// Container-width breakpoints, written out so every class exists at build time.
const MEDIUM: Record<number, string> = { 3: '@min-[40rem]/dashboard:col-span-3', 6: '@min-[40rem]/dashboard:col-span-6' };
const WIDE: Record<number, string> = { 3: '@min-[64rem]/dashboard:col-span-3', 4: '@min-[64rem]/dashboard:col-span-4', 5: '@min-[64rem]/dashboard:col-span-5', 6: '@min-[64rem]/dashboard:col-span-6', 7: '@min-[64rem]/dashboard:col-span-7', 8: '@min-[64rem]/dashboard:col-span-8', 9: '@min-[64rem]/dashboard:col-span-9', 10: '@min-[64rem]/dashboard:col-span-10', 11: '@min-[64rem]/dashboard:col-span-11', 12: '@min-[64rem]/dashboard:col-span-12' };
const MEDIUM_PX = 640, WIDE_PX = 1024;

/**
 * A workspace Dashboard's widget grid: 12 columns where the dashboard itself is at least 64rem
 * wide, 6 from 40rem, one below — measured on the dashboard's own container, so the sidebar or an
 * open inspector changes the layout exactly as a smaller window would. In normal use nothing moves.
 * Customizing shows a toolbar and per-widget controls; pointer dragging and resizing use the same
 * layout functions as the buttons and keys, so both produce the same valid layouts.
 */
export function DashboardLayoutGrid({ registry, saved: initial, readable, widgets, onSave, onReset, label }: {
  registry: readonly WidgetDefinition[]; saved: Saved; readable: readonly string[];
  widgets: Record<string, DashboardWidgetContent>;
  /** Absent where layouts are not stored (a Dashboard drawn with the product default); there is then no editor to open. */
  onSave?: (layout: DashboardLayout, expectedRevision: number) => Promise<SaveLayoutResult>;
  onReset?: () => Promise<{ error?: string }>;
  label: string;
}) {
  const editingContext = useContext(EditingContext), stop = useContext(StopContext);
  const editing = Boolean(editingContext?.editing && onSave);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.layout);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'status'; text: string; conflict?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(WIDE_PX);
  useLayoutEffect(() => {
    const node = containerRef.current; if (!node) return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setContainerWidth(node.clientWidth)); });
    observer.observe(node); setContainerWidth(node.clientWidth);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const mode = containerWidth >= WIDE_PX ? 'wide' : containerWidth >= MEDIUM_PX ? 'medium' : 'narrow';
  const layout = editing ? draft : saved.layout;
  const readableSet = useMemo(() => new Set(readable), [readable]);
  const shown = visibleWidgets(layout, readableSet);
  const spans = arrange(registry, shown);
  const definitions = useMemo(() => new Map(registry.map(definition => [definition.id, definition])), [registry]);
  const dirty = editing && !sameLayout(draft, saved.layout);
  useUnsavedChanges(dirty);
  const hidden = layout.widgets.filter(widget => widget.hidden && readableSet.has(widget.id));

  const finish = () => { setSelected(null); setMessage(null); stop(); };
  const cancel = () => { setDraft(saved.layout); finish(); };
  const save = async () => {
    if (!onSave) return;
    setBusy(true); setMessage(null);
    const result = await onSave(canonicalLayout(draft), saved.revision);
    setBusy(false);
    if (result.error !== undefined) { setMessage({ tone: 'error', text: result.error, conflict: result.conflict }); return; }
    setSaved({ layout: canonicalLayout(draft), revision: result.revision, customized: true });
    finish(); setMessage({ tone: 'status', text: 'Dashboard layout saved.' });
  };
  const reset = async () => {
    if (!onReset) return;
    setBusy(true); setMessage(null);
    const result = await onReset();
    setBusy(false);
    if (result.error) { setMessage({ tone: 'error', text: result.error }); return; }
    const fresh = defaultLayout(registry);
    setSaved({ layout: fresh, revision: 0, customized: false }); setDraft(fresh);
    finish(); setMessage({ tone: 'status', text: 'Dashboard layout reset to the default.' });
  };
  // Opening the editor starts from what is saved.
  const [openedFor, setOpenedFor] = useState(false);
  if (editing && !openedFor) { setOpenedFor(true); setDraft(saved.layout); }
  if (!editing && openedFor) setOpenedFor(false);

  const change = useCallback((next: DashboardLayout) => setDraft(next), []);
  const columnWidth = () => { const grid = containerRef.current?.querySelector<HTMLElement>('[data-dashboard-grid]'); if (!grid) return { column: 80, gap: 16 }; const gap = parseFloat(getComputedStyle(grid).columnGap) || 16; const columns = mode === 'wide' ? 12 : 6; return { column: (grid.clientWidth - gap * (columns - 1)) / columns, gap }; };

  return <div ref={containerRef} className="@container/dashboard min-w-0" data-editing={editing || undefined} aria-label={label} role="region">
    {editing ? <div role="toolbar" aria-label="Customize dashboard" className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-[var(--visual-radius,0.625rem)] border border-accent bg-surface px-3 py-2 shadow-[var(--visual-overlay-shadow)]">
      <p className="mr-auto text-sm font-medium">Customizing your dashboard{mode === 'narrow' ? ' · every widget is full width on this screen' : ''}</p>
      {hidden.length ? <span className="flex flex-wrap items-center gap-1 text-xs text-muted">Hidden:{hidden.map(widget => <Button key={widget.id} type="button" tone="ghost" size="tiny" onClick={() => change(setWidgetOption(draft, registry, widget.id, { hidden: false }))}>Show {definitions.get(widget.id)?.label}</Button>)}</span> : null}
      <Button type="button" tone="text" size="small" disabled={busy || (!saved.customized && sameLayout(draft, defaultLayout(registry)))} onClick={reset}>Reset to default</Button>
      <Button type="button" tone="secondary" size="small" disabled={busy} onClick={cancel}>Cancel</Button>
      <Button type="button" size="small" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Button>
    </div> : null}
    {message ? <div role={message.tone === 'error' ? 'alert' : 'status'} className={cx('mb-4 flex flex-wrap items-center gap-2 rounded-[var(--visual-radius,0.625rem)] border px-3 py-2 text-sm', message.tone === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-surface')}>
      <span className="mr-auto">{message.text}</span>
      {message.conflict ? <Button type="button" size="tiny" tone="secondary" onClick={() => window.location.reload()}>Reload</Button> : null}
      {message.tone === 'status' ? <Button type="button" size="tiny" tone="ghost" onClick={() => setMessage(null)}>Dismiss</Button> : null}
    </div> : null}
    <div data-dashboard-grid className={cx('grid grid-cols-1 gap-4 @min-[40rem]/dashboard:grid-cols-6 @min-[64rem]/dashboard:grid-cols-12', editing && 'select-none')}>
      {shown.map((placement, index) => <DashboardWidget key={placement.id} placement={placement} definition={definitions.get(placement.id)!} content={widgets[placement.id]}
        className={cx('col-span-1', MEDIUM[spans.medium.get(placement.id)!], WIDE[spans.wide.get(placement.id)!])}
        editing={editing} mode={mode} selected={selected === placement.id} onSelect={() => setSelected(placement.id)}
        first={index === 0} last={index === shown.length - 1} filled={(spans[mode === 'medium' ? 'medium' : 'wide'].get(placement.id) ?? 0) > (mode === 'medium' ? (placement.span > 6 ? 6 : 3) : placement.span)}
        onLayout={update => change(update(draft))} registry={registry} visible={readableSet} measure={columnWidth} />)}
    </div>
  </div>;
}

function DashboardWidget({ placement, definition, content, className, editing, mode, selected, onSelect, first, last, filled, onLayout, registry, visible, measure }: {
  placement: WidgetPlacement; definition: WidgetDefinition; content: DashboardWidgetContent | undefined; className: string;
  editing: boolean; mode: 'wide' | 'medium' | 'narrow'; selected: boolean; onSelect: () => void; first: boolean; last: boolean; filled: boolean;
  onLayout: (update: (layout: DashboardLayout) => DashboardLayout) => void; registry: readonly WidgetDefinition[]; visible: ReadonlySet<string>;
  measure: () => { column: number; gap: number };
}) {
  const [variant, setVariant] = useState(content?.kind === 'chart' ? content.variants[0]?.key : undefined);
  const [drag, setDrag] = useState<null | 'move' | 'resize'>(null);
  const start = useRef({ x: 0, width: 0, active: false });
  const ref = useRef<HTMLDivElement>(null);
  const pointerResize = mode !== 'narrow';
  const resizeStart = (event: PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start.current = { x: event.clientX, width: ref.current?.getBoundingClientRect().width ?? 0, active: true }; setDrag('resize'); };
  const resizeEnd = () => { start.current.active = false; setDrag(null); };
  const resizeMove = (event: PointerEvent<HTMLButtonElement>) => {
    // A ref, not state: the press must arm the drag before the first move is handled.
    if (!start.current.active) return;
    const { column, gap } = measure();
    const columns = Math.round((start.current.width + (event.clientX - start.current.x) + gap) / (column + gap));
    // At intermediate width a column is half of the 12-column span: 3 shown columns are 6 saved ones.
    onLayout(layout => resizeWidget(layout, registry, placement.id, mode === 'medium' ? columns * 2 : columns));
  };
  const moveEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag === 'move') {
      const target = document.elementsFromPoint(event.clientX, event.clientY).map(node => (node as HTMLElement).closest<HTMLElement>('[data-widget-id]')).find(node => node && node.dataset.widgetId !== placement.id);
      if (target) { const box = target.getBoundingClientRect(); const after = mode === 'narrow' ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2; onLayout(layout => { const without = layout.widgets.filter(widget => widget.id !== placement.id); const index = without.findIndex(widget => widget.id === target.dataset.widgetId); return moveWidget(layout, placement.id, index + (after ? 1 : 0)); }); }
    }
    setDrag(null);
  };
  const resizeKeys = (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); onLayout(layout => stepWidth(layout, registry, placement.id, event.key === 'ArrowRight' ? 1 : -1)); } };
  const body = !content ? null : content.kind === 'node' ? (placement.density && content.densities?.[placement.density]) ?? content.node : (() => {
    const chosen = content.variants.find(entry => entry.key === variant) ?? content.variants[0];
    return <div data-slot="chart-panel" className="h-full min-w-0 rounded-lg border border-border bg-surface p-4">{chosen ? <Chart title={content.title} data={chosen.data} state={content.state} height={placement.height} variants={content.variants.map(entry => ({ key: entry.key, label: entry.label }))} variant={chosen.key} onVariantChange={setVariant}
      presentation={placement.presentation} onPresentationChange={editing ? presentation => onLayout(layout => setWidgetOption(layout, registry, placement.id, { presentation })) : undefined} /> : null}{content.footer}</div>;
  })();
  // A plain container: each widget's content names itself (a panel title or chart heading), so landmarks are not doubled.
  return <div ref={ref} data-widget-id={placement.id} data-span={placement.span}
    onClick={editing ? onSelect : undefined} onFocus={editing ? onSelect : undefined}
    className={cx(className, 'relative flex min-w-0 flex-col', editing && 'rounded-[var(--visual-radius,0.625rem)] outline-2 outline-offset-4', editing && (selected ? 'outline outline-accent' : 'outline outline-dashed outline-border'), drag === 'move' && 'opacity-60')}>
    {editing ? <div role="group" aria-label={`Arrange ${definition.label}`} className="mb-2 flex flex-wrap items-center gap-1.5 rounded-[var(--visual-radius,0.625rem)] bg-secondary px-2 py-1.5 text-xs">
      {mode !== 'narrow' ? <button type="button" aria-label={`Drag to move ${definition.label}`} title="Drag to move" className={cx('cursor-grab touch-none rounded p-1 hover:bg-hover active:cursor-grabbing', FOCUS_RING)}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDrag('move'); }} onPointerUp={moveEnd} onPointerCancel={() => setDrag(null)}><GripVertical aria-hidden className="size-4" /></button> : null}
      <span className="mr-auto font-medium">{definition.label}</span>
      <Button type="button" size="tiny" tone="ghost" disabled={first} aria-label={`Move ${definition.label} earlier`} onClick={() => onLayout(layout => stepWidget(layout, placement.id, -1, visible))}>{mode === 'narrow' ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowLeft aria-hidden className="size-3.5" />}Earlier</Button>
      <Button type="button" size="tiny" tone="ghost" disabled={last} aria-label={`Move ${definition.label} later`} onClick={() => onLayout(layout => stepWidget(layout, placement.id, 1, visible))}>{mode === 'narrow' ? <ArrowDown aria-hidden className="size-3.5" /> : <ArrowRight aria-hidden className="size-3.5" />}Later</Button>
      {mode !== 'narrow' && definition.spans.length > 1 ? <span className="flex items-center gap-0.5">
        <Button type="button" size="tiny" tone="ghost" aria-label={`Decrease width of ${definition.label}`} disabled={placement.span === Math.min(...definition.spans)} onClick={() => onLayout(layout => stepWidth(layout, registry, placement.id, -1))}>−</Button>
        <span aria-live="polite" className="min-w-16 text-center tabular-nums">{SPAN_LABEL[placement.span as WidgetSpan]}{filled ? <span className="text-muted"> · widened to fill its row</span> : null}</span>
        <Button type="button" size="tiny" tone="ghost" aria-label={`Increase width of ${definition.label}`} disabled={placement.span === Math.max(...definition.spans)} onClick={() => onLayout(layout => stepWidth(layout, registry, placement.id, 1))}>+</Button>
      </span> : null}
      {definition.heights.length > 1 ? <SelectInput size="small" aria-label={`Height of ${definition.label}`} value={placement.height} onChange={event => onLayout(layout => setWidgetOption(layout, registry, placement.id, { height: event.target.value as WidgetHeight }))} className="w-28">{definition.heights.map(height => <option key={height} value={height}>{HEIGHT_LABEL[height]}</option>)}</SelectInput> : null}
      {definition.densities ? <SelectInput size="small" aria-label={`Row density of ${definition.label}`} value={placement.density} onChange={event => onLayout(layout => setWidgetOption(layout, registry, placement.id, { density: event.target.value as WidgetDensity }))} className="w-32">{definition.densities.map(density => <option key={density} value={density}>{density === 'compact' ? 'Compact rows' : 'Comfortable rows'}</option>)}</SelectInput> : null}
      {definition.hideable ? <Button type="button" size="tiny" tone="ghost" aria-label={`Hide ${definition.label}`} onClick={() => onLayout(layout => setWidgetOption(layout, registry, placement.id, { hidden: true }))}><EyeOff aria-hidden className="size-3.5" />Hide</Button> : null}
    </div> : null}
    {/* The body fills the cell, so panels sharing a row end at the same line. */}
    <div className="flex min-h-0 flex-1 flex-col [&>*]:flex-1">{body}</div>
    {editing && pointerResize && definition.spans.length > 1 ? <button type="button" aria-label={`Resize ${definition.label}, currently ${SPAN_LABEL[placement.span as WidgetSpan]}. Use left and right arrows.`}
      className={cx('absolute -right-3 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded border border-accent bg-surface shadow', FOCUS_RING)}
      onPointerDown={resizeStart} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} onLostPointerCapture={resizeEnd} onKeyDown={resizeKeys}><MoveHorizontal aria-hidden className="size-3.5" /></button> : null}
  </div>;
}
