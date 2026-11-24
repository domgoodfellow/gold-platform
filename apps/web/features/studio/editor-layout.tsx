'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Maximize2, Minimize2, PanelLeft, PanelRight } from 'lucide-react';
import { cx, FOCUS_RING } from '@/components/class-names';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle } from '@/components/panels/page-drawer';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Below this workbench width the side panels open as page drawers instead of columns. */
export const COMPACT_BELOW = 896;
const CANVAS_MIN = 320;
const SEPARATOR = 12;
const STEP = 16;

type Side = 'structure' | 'inspector';
type PanelBounds = { min: number; max: number; initial: number };
export const PANEL_BOUNDS: Record<Side, PanelBounds> = {
  structure: { min: 192, max: 416, initial: 224 },
  inspector: { min: 240, max: 480, initial: 288 },
};

type LayoutState = { widths: Record<Side, number>; collapsed: Record<Side, boolean> };
const INITIAL: LayoutState = {
  widths: { structure: PANEL_BOUNDS.structure.initial, inspector: PANEL_BOUNDS.inspector.initial },
  collapsed: { structure: false, inspector: false },
};

const clamp = (value: number, { min, max }: PanelBounds) => Math.min(max, Math.max(min, Math.round(value)));
const storageKey = (id: string) => `gold.editor-layout.${id}`;
const CHANGED = 'gold:editor-layout-changed';

/** This browser's remembered layout for an editor: an external store, read without an effect. */
function readRaw(id: string): string | null {
  try { return window.localStorage.getItem(storageKey(id)); } catch { return null; }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGED, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener('storage', callback);
  };
}

function parseLayout(raw: string | null): LayoutState {
  try {
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      widths: {
        structure: clamp(Number(parsed.widths?.structure ?? INITIAL.widths.structure), PANEL_BOUNDS.structure),
        inspector: clamp(Number(parsed.widths?.inspector ?? INITIAL.widths.inspector), PANEL_BOUNDS.inspector),
      },
      collapsed: { structure: parsed.collapsed?.structure === true, inspector: parsed.collapsed?.inspector === true },
    };
  } catch {
    return INITIAL;
  }
}

function PanelToggle({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cx('inline-flex size-8 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-foreground aria-pressed:text-foreground', FOCUS_RING)}
    >
      {children}
    </button>
  );
}

/**
 * The column boundary between a side panel and the canvas. A pointer drags it; with focus, the
 * arrow keys move it by 16px (64px with Shift), Home and End go to the panel's minimum and maximum,
 * and Enter collapses the panel.
 */
function Separator({ side, label, width, max, onResize, onCollapse }: {
  side: Side;
  label: string;
  width: number;
  max: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const direction = side === 'structure' ? 1 : -1;
  const bounds = { ...PANEL_BOUNDS[side], max };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP * 4 : STEP;
    const moves: Record<string, number | undefined> = {
      ArrowLeft: width - step * direction, ArrowRight: width + step * direction,
      Home: bounds.min, End: bounds.max,
    };
    if (event.key === 'Enter') { event.preventDefault(); onCollapse(); return; }
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onResize(clamp(next, bounds));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (!start.current) return;
        onResize(clamp(start.current.width + (event.clientX - start.current.x) * direction, bounds));
      }}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={() => onResize(PANEL_BOUNDS[side].initial)}
      className={cx(
        'relative cursor-col-resize touch-none rounded',
        'before:absolute before:inset-y-2 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition',
        'hover:before:w-0.5 hover:before:bg-foreground/40 focus-visible:before:bg-foreground/60',
        FOCUS_RING,
      )}
      style={{ width: SEPARATOR }}
    />
  );
}

function Pane({ label, title, hidden, scroll = true, className, children }: { label: string; title: string; hidden: boolean; scroll?: boolean; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} hidden={hidden} className={cx('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border', className)}>
      <h2 className="shrink-0 border-b border-border px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className={cx('min-h-0 flex-1', scroll && 'overflow-y-auto overscroll-contain p-3')}>{children}</div>
    </section>
  );
}

/**
 * Studio's workbench: Structure | Canvas | Inspector over one thing being edited (a website, a
 * form). Every editor uses this one layout rather than its own panels.
 *
 * - **Wide** (the workbench at least `COMPACT_BELOW` wide): side panels are columns, each resizable
 *   between its minimum and maximum, collapsible and restorable on its own; Maximize gives the
 *   canvas the whole width and restores the panels as they were. Each pane scrolls itself inside a
 *   workbench one screen tall; the page does not scroll the panes.
 * - **Compact**: the canvas fills the width and the page scrolls; the same toggles open the panels
 *   as page drawers.
 *
 * Widths and collapsed panels are remembered per editor (`id`) in this browser. Editing state
 * belongs to the editor that renders this, so resizing, collapsing, maximizing or moving between
 * layouts never discards it; collapsed columns stay mounted.
 */
export function EditorLayout({ id, structure, inspector, children, structureLabel = 'Structure', inspectorLabel = 'Inspector', canvasLabel = 'Canvas', canvasTools }: {
  /** Which editor this is, for its remembered layout. */
  id: string;
  structure: ReactNode;
  inspector: ReactNode;
  children: ReactNode;
  structureLabel?: string;
  inspectorLabel?: string;
  canvasLabel?: string;
  /** Controls that belong to the canvas (e.g. its reference width), in its header. */
  canvasTools?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  // The server cannot know this browser's layout: it renders the initial one, and the browser's
  // remembered layout takes over after hydration. Written only when a person changes it.
  const raw = useSyncExternalStore(subscribe, () => readRaw(id), () => null);
  const stored = useMemo(() => parseLayout(raw), [raw]);
  // Where storage is refused (a private window), the layout still changes for this visit.
  const [unsaved, setUnsaved] = useState<LayoutState | null>(null);
  const layout = unsaved ?? stored;
  const [maximized, setMaximized] = useState(false);
  const [drawer, setDrawer] = useState<Side | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!root.current) return;
    // Zero means not laid out yet (or no layout engine at all): keep the wide layout until measured.
    const measure = (value: number) => setAvailable(value > 0 ? value : null);
    measure(root.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry!.contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);


  const compact = available !== null && available < COMPACT_BELOW;
  const showStructure = !compact && !maximized && !layout.collapsed.structure;
  const showInspector = !compact && !maximized && !layout.collapsed.inspector;

  // A panel can grow only as far as leaves the canvas its minimum.
  const room = (side: Side) => {
    if (available === null) return PANEL_BOUNDS[side].max;
    const other: Side = side === 'structure' ? 'inspector' : 'structure';
    const otherWidth = (other === 'structure' ? showStructure : showInspector) ? layout.widths[other] + SEPARATOR : 0;
    return Math.max(PANEL_BOUNDS[side].min, Math.min(PANEL_BOUNDS[side].max, available - otherWidth - SEPARATOR - CANVAS_MIN));
  };
  const width = (side: Side) => Math.min(layout.widths[side], room(side));

  const change = useCallback((next: (current: LayoutState) => LayoutState) => {
    const value = next(layout);
    try {
      window.localStorage.setItem(storageKey(id), JSON.stringify(value));
      window.dispatchEvent(new Event(CHANGED));
    } catch {
      setUnsaved(value);
    }
  }, [id, layout]);
  const resize = useCallback((side: Side, value: number) => change((current) => ({ ...current, widths: { ...current.widths, [side]: value } })), [change]);
  const toggle = (side: Side) => {
    if (compact) { setDrawer((current) => (current === side ? null : side)); return; }
    if (maximized) { setMaximized(false); change((current) => ({ ...current, collapsed: { ...current.collapsed, [side]: false } })); return; }
    change((current) => ({ ...current, collapsed: { ...current.collapsed, [side]: !current.collapsed[side] } }));
  };

  const columns = [
    showStructure ? `${width('structure')}px ${SEPARATOR}px` : null,
    'minmax(0,1fr)',
    showInspector ? `${SEPARATOR}px ${width('inspector')}px` : null,
  ].filter(Boolean).join(' ');

  const structureOpen = compact ? drawer === 'structure' : showStructure;
  const inspectorOpen = compact ? drawer === 'inspector' : showInspector;

  return (
    <div
      ref={root}
      data-editor-layout={compact ? 'compact' : 'wide'}
      data-maximized={maximized || undefined}
      className={cx('grid min-w-0', !compact && 'h-[max(32rem,calc(100dvh-13rem))]')}
      style={compact ? undefined : { gridTemplateColumns: columns }}
    >
      {!compact ? (
        <>
          <Pane label={structureLabel} title={structureLabel} hidden={!showStructure} className="bg-surface">{structure}</Pane>
          {showStructure ? (
            <Separator side="structure" label={`Resize ${structureLabel}`} width={width('structure')} max={room('structure')}
              onResize={(value) => resize('structure', value)} onCollapse={() => toggle('structure')} />
          ) : null}
        </>
      ) : null}

      <section aria-label={canvasLabel} className={cx('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-secondary', !compact && 'min-h-0')}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-2 py-1.5">
          <PanelToggle label={structureOpen ? `Hide ${structureLabel}` : `Show ${structureLabel}`} pressed={structureOpen} onClick={() => toggle('structure')}>
            <PanelLeft aria-hidden className="size-4" />
          </PanelToggle>
          <h2 className="mr-auto px-1 text-sm font-semibold">{canvasLabel}</h2>
          {canvasTools}
          {!compact ? (
            <PanelToggle label={maximized ? 'Restore panels' : 'Maximize canvas'} pressed={maximized} onClick={() => setMaximized((value) => !value)}>
              {maximized ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
            </PanelToggle>
          ) : null}
          <PanelToggle label={inspectorOpen ? `Hide ${inspectorLabel}` : `Show ${inspectorLabel}`} pressed={inspectorOpen} onClick={() => toggle('inspector')}>
            <PanelRight aria-hidden className="size-4" />
          </PanelToggle>
        </div>
        <div data-editor-canvas className={cx('min-w-0 overflow-x-hidden p-3 sm:p-5', !compact && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>{children}</div>
      </section>

      {!compact ? (
        <>
          {showInspector ? (
            <Separator side="inspector" label={`Resize ${inspectorLabel}`} width={width('inspector')} max={room('inspector')}
              onResize={(value) => resize('inspector', value)} onCollapse={() => toggle('inspector')} />
          ) : null}
          <Pane label={inspectorLabel} title={inspectorLabel} hidden={!showInspector} className="bg-surface">{inspector}</Pane>
        </>
      ) : (
        <>
          <PageDrawer open={drawer === 'structure'} onOpenChange={(open) => setDrawer(open ? 'structure' : null)}>
            <PageDrawerContent>
              <PageDrawerHeader><PageDrawerTitle>{structureLabel}</PageDrawerTitle></PageDrawerHeader>
              {structure}
            </PageDrawerContent>
          </PageDrawer>
          <PageDrawer open={drawer === 'inspector'} onOpenChange={(open) => setDrawer(open ? 'inspector' : null)}>
            <PageDrawerContent>
              <PageDrawerHeader><PageDrawerTitle>{inspectorLabel}</PageDrawerTitle></PageDrawerHeader>
              {inspector}
            </PageDrawerContent>
          </PageDrawer>
        </>
      )}
    </div>
  );
}
