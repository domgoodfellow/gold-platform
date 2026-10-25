/**
 * Personal Dashboard layout: the one algorithm for ordering, sizing and packing a workspace
 * Dashboard's widgets, shared by the browser (editing, pointer and keyboard alike) and the server
 * (validation before a save). Presentation only: a layout never grants a widget, and a widget the
 * viewer may not read is dropped before anything is drawn or queried.
 *
 * Grid: 12 columns where the dashboard container is wide, 6 at intermediate width, 1 on a phone.
 * Widths are chosen from each widget's allowed spans. Rows are packed in order; a row never ends
 * with an unusable gap, because the last widget in a row widens to fill it. Nothing overlaps.
 */

export const LAYOUT_VERSION = 1;
export type WidgetSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetHeight = 'compact' | 'standard' | 'tall';
export type WidgetDensity = 'compact' | 'comfortable';
export const WIDGET_SPANS: readonly WidgetSpan[] = [3, 4, 6, 8, 12];
export const SPAN_LABEL: Record<WidgetSpan, string> = { 3: 'Quarter', 4: 'Third', 6: 'Half', 8: 'Two thirds', 12: 'Full width' };
export const HEIGHT_LABEL: Record<WidgetHeight, string> = { compact: 'Compact', standard: 'Standard', tall: 'Tall' };

export type WidgetDefinition = {
  id: string;
  label: string;
  spans: readonly WidgetSpan[];
  defaultSpan: WidgetSpan;
  heights: readonly WidgetHeight[];
  defaultHeight: WidgetHeight;
  /** Presentations a person may choose; the first is the default. Absent for a widget with one presentation. */
  presentations?: readonly string[];
  densities?: readonly WidgetDensity[];
  /** Secondary widgets may be hidden; core ones (overview, attention) may not. */
  hideable: boolean;
  /** Dense content that needs the full width at intermediate widths. */
  fullOnTablet?: boolean;
};

export type WidgetPlacement = { id: string; span: WidgetSpan; height: WidgetHeight; presentation?: string; density?: WidgetDensity; hidden?: boolean };
export type DashboardLayout = { version: typeof LAYOUT_VERSION; widgets: WidgetPlacement[] };
export type LayoutMode = 'wide' | 'medium' | 'narrow';
export const COLUMNS: Record<LayoutMode, number> = { wide: 12, medium: 6, narrow: 1 };

const byId = (registry: readonly WidgetDefinition[]) => new Map(registry.map(definition => [definition.id, definition]));

export function defaultLayout(registry: readonly WidgetDefinition[]): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets: registry.map(definition => ({ id: definition.id, span: definition.defaultSpan, height: definition.defaultHeight, ...(definition.presentations ? { presentation: definition.presentations[0] } : {}), ...(definition.densities ? { density: definition.densities[0] } : {}) })) };
}

/** Every reason a submitted layout is refused; empty means valid. Strict: nothing is repaired on the way in. */
export function layoutProblems(registry: readonly WidgetDefinition[], input: unknown): string[] {
  const problems: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Layout is not an object.'];
  const layout = input as Record<string, unknown>;
  if (layout.version !== LAYOUT_VERSION) problems.push('Unsupported layout version.');
  if (!Array.isArray(layout.widgets)) return [...problems, 'Layout has no widget list.'];
  if (Object.keys(layout).some(key => key !== 'version' && key !== 'widgets')) problems.push('Layout has unknown fields.');
  const definitions = byId(registry), seen = new Set<string>();
  for (const raw of layout.widgets as unknown[]) {
    if (!raw || typeof raw !== 'object') { problems.push('A widget entry is not an object.'); continue; }
    const widget = raw as Record<string, unknown>;
    const definition = typeof widget.id === 'string' ? definitions.get(widget.id) : undefined;
    if (!definition) { problems.push('Unsupported widget.'); continue; }
    if (seen.has(definition.id)) problems.push(`${definition.label} appears twice.`);
    seen.add(definition.id);
    if (Object.keys(widget).some(key => !['id', 'span', 'height', 'presentation', 'density', 'hidden'].includes(key))) problems.push(`${definition.label} has unknown settings.`);
    if (!definition.spans.includes(widget.span as WidgetSpan)) problems.push(`${definition.label} cannot be that wide.`);
    if (!definition.heights.includes(widget.height as WidgetHeight)) problems.push(`${definition.label} cannot be that tall.`);
    if (widget.presentation !== undefined && !(definition.presentations ?? []).includes(widget.presentation as string)) problems.push(`${definition.label} cannot be shown that way.`);
    if (widget.density !== undefined && !(definition.densities ?? []).includes(widget.density as WidgetDensity)) problems.push(`${definition.label} has an unsupported density.`);
    if (widget.hidden !== undefined && (typeof widget.hidden !== 'boolean' || (widget.hidden && !definition.hideable))) problems.push(`${definition.label} cannot be hidden.`);
  }
  for (const definition of registry) if (!seen.has(definition.id)) problems.push(`${definition.label} is missing.`);
  return problems;
}

/**
 * A stored layout made usable against today's registry: unknown or duplicate widgets dropped, values
 * the registry no longer allows reset to its default, and widgets added since appended after the
 * widget that precedes them by default. Used when reading, never to accept a save.
 */
export function normalizeLayout(registry: readonly WidgetDefinition[], stored: unknown): DashboardLayout {
  const base = defaultLayout(registry);
  if (!stored || typeof stored !== 'object' || (stored as { version?: unknown }).version !== LAYOUT_VERSION || !Array.isArray((stored as { widgets?: unknown }).widgets)) return base;
  const definitions = byId(registry), seen = new Set<string>(), widgets: WidgetPlacement[] = [];
  for (const raw of (stored as { widgets: unknown[] }).widgets) {
    const widget = raw as Partial<WidgetPlacement>;
    const definition = widget && typeof widget.id === 'string' ? definitions.get(widget.id) : undefined;
    if (!definition || seen.has(definition.id)) continue;
    seen.add(definition.id);
    const fallback = base.widgets.find(entry => entry.id === definition.id)!;
    widgets.push({
      id: definition.id,
      span: definition.spans.includes(widget.span as WidgetSpan) ? widget.span as WidgetSpan : fallback.span,
      height: definition.heights.includes(widget.height as WidgetHeight) ? widget.height as WidgetHeight : fallback.height,
      ...(definition.presentations ? { presentation: definition.presentations.includes(widget.presentation as string) ? widget.presentation : fallback.presentation } : {}),
      ...(definition.densities ? { density: definition.densities.includes(widget.density as WidgetDensity) ? widget.density : fallback.density } : {}),
      ...(definition.hideable && widget.hidden === true ? { hidden: true } : {}),
    });
  }
  registry.forEach((definition, index) => {
    if (seen.has(definition.id)) return;
    const previous = registry.slice(0, index).reverse().find(candidate => widgets.some(widget => widget.id === candidate.id));
    const at = previous ? widgets.findIndex(widget => widget.id === previous.id) + 1 : 0;
    widgets.splice(at, 0, base.widgets[index]);
  });
  return { version: LAYOUT_VERSION, widgets };
}

const replace = (layout: DashboardLayout, id: string, change: (widget: WidgetPlacement) => WidgetPlacement): DashboardLayout => ({ ...layout, widgets: layout.widgets.map(widget => widget.id === id ? change(widget) : widget) });

/** Moves a widget to an index in the full order (hidden widgets keep their places). */
export function moveWidget(layout: DashboardLayout, id: string, toIndex: number): DashboardLayout {
  const from = layout.widgets.findIndex(widget => widget.id === id);
  if (from < 0) return layout;
  const widgets = [...layout.widgets];
  const [moved] = widgets.splice(from, 1);
  widgets.splice(Math.max(0, Math.min(widgets.length, toIndex)), 0, moved);
  return { ...layout, widgets };
}

/** Moves one place earlier or later among the widgets the person can see, skipping hidden or unreadable ones. */
export function stepWidget(layout: DashboardLayout, id: string, delta: -1 | 1, visible: ReadonlySet<string>): DashboardLayout {
  const order = layout.widgets.filter(widget => visible.has(widget.id) && !widget.hidden).map(widget => widget.id);
  const position = order.indexOf(id), target = order[position + delta];
  if (position < 0 || !target) return layout;
  const targetIndex = layout.widgets.findIndex(widget => widget.id === target);
  return moveWidget(layout, id, targetIndex);
}

/** Sets a width, snapped to the nearest span this widget allows. Pointer resizing calls this with the span under the pointer. */
export function resizeWidget(layout: DashboardLayout, registry: readonly WidgetDefinition[], id: string, span: number): DashboardLayout {
  const definition = byId(registry).get(id);
  if (!definition) return layout;
  const snapped = [...definition.spans].sort((a, b) => Math.abs(a - span) - Math.abs(b - span) || a - b)[0];
  return replace(layout, id, widget => ({ ...widget, span: snapped }));
}

/** The next wider or narrower allowed span, or the same one at either end. */
export function stepWidth(layout: DashboardLayout, registry: readonly WidgetDefinition[], id: string, delta: -1 | 1): DashboardLayout {
  const definition = byId(registry).get(id), widget = layout.widgets.find(entry => entry.id === id);
  if (!definition || !widget) return layout;
  const spans = [...definition.spans].sort((a, b) => a - b);
  const next = spans[Math.max(0, Math.min(spans.length - 1, spans.indexOf(widget.span) + delta))];
  return replace(layout, id, entry => ({ ...entry, span: next }));
}

export function setWidgetOption(layout: DashboardLayout, registry: readonly WidgetDefinition[], id: string, option: { height?: WidgetHeight; presentation?: string; density?: WidgetDensity; hidden?: boolean }): DashboardLayout {
  const definition = byId(registry).get(id);
  if (!definition) return layout;
  return replace(layout, id, widget => ({
    ...widget,
    ...(option.height && definition.heights.includes(option.height) ? { height: option.height } : {}),
    ...(option.presentation && definition.presentations?.includes(option.presentation) ? { presentation: option.presentation } : {}),
    ...(option.density && definition.densities?.includes(option.density) ? { density: option.density } : {}),
    ...(option.hidden !== undefined && definition.hideable ? { hidden: option.hidden || undefined } : {}),
  }));
}

/** Span a widget takes at each width: half or full at intermediate width, full on a phone. */
export function modeSpan(definition: WidgetDefinition | undefined, span: WidgetSpan, mode: LayoutMode): number {
  if (mode === 'narrow') return 1;
  if (mode === 'medium') return definition?.fullOnTablet || span > 6 ? 6 : 3;
  return span;
}

/**
 * Rows in reading order for one mode. A widget that does not fit the rest of a row starts the next;
 * the last widget of a row takes any columns left, so no row has a gap and nothing overlaps.
 */
export function packRows(widgets: readonly { id: string; span: number }[], columns: number): { id: string; span: number; row: number }[] {
  const placed: { id: string; span: number; row: number }[] = [];
  let row = 0, used = 0;
  for (const widget of widgets) {
    const span = Math.min(columns, Math.max(1, widget.span));
    if (used + span > columns) { if (placed.length) placed[placed.length - 1].span += columns - used; row += 1; used = 0; }
    placed.push({ id: widget.id, span, row });
    used += span;
  }
  if (placed.length && used < columns) placed[placed.length - 1].span += columns - used;
  return placed;
}

/** The widgets to draw: not hidden, and readable by this viewer. Unreadable ones vanish without a trace of their name or data. */
export function visibleWidgets(layout: DashboardLayout, readable: ReadonlySet<string>): WidgetPlacement[] {
  return layout.widgets.filter(widget => readable.has(widget.id) && !widget.hidden);
}

/** Effective span per mode for the drawn widgets, packed. */
export function arrange(registry: readonly WidgetDefinition[], widgets: readonly WidgetPlacement[]): Record<LayoutMode, Map<string, number>> {
  const definitions = byId(registry);
  const result = {} as Record<LayoutMode, Map<string, number>>;
  for (const mode of ['wide', 'medium', 'narrow'] as const) result[mode] = new Map(packRows(widgets.map(widget => ({ id: widget.id, span: modeSpan(definitions.get(widget.id), widget.span, mode) })), COLUMNS[mode]).map(entry => [entry.id, entry.span]));
  return result;
}

/** One spelling of a layout: fixed key order, no empty options. What is saved and what is compared. */
export function canonicalLayout(layout: DashboardLayout): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets: layout.widgets.map(widget => ({ id: widget.id, span: widget.span, height: widget.height, ...(widget.presentation ? { presentation: widget.presentation } : {}), ...(widget.density ? { density: widget.density } : {}), ...(widget.hidden ? { hidden: true } : {}) })) };
}

export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return JSON.stringify(canonicalLayout(a)) === JSON.stringify(canonicalLayout(b));
}
