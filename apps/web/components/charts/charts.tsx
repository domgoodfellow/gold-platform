'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert, Inbox, Loader2 } from 'lucide-react';
import { SelectInput } from '../controls/inputs';
import { cx, FOCUS_RING } from '../class-names';
import {
  allowedPresentations, describeFormat, formatTick, hasValues, labelStride, linearScale, niceTicks, PRESENTATION_LABEL, resolvePresentation, seriesColor, seriesDash,
  type ChartData, type ChartPresentation, type ChartState,
} from '@/lib/chart-model';

export type ChartHeight = 'compact' | 'standard' | 'tall';
/** Heights from the spacing scale; the plot measures what it is given rather than assuming pixels. */
const HEIGHT: Record<ChartHeight, string> = { compact: 'h-40', standard: 'h-56', tall: 'h-72' };
const MARKERS = ['circle', 'square', 'triangle', 'diamond'] as const;

/** The plot's measured size, updated at most once per frame while its container resizes. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setSize(previous => previous.width === node.clientWidth && previous.height === node.clientHeight ? previous : { width: node.clientWidth, height: node.clientHeight })); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return [ref, size] as const;
}

/** A chart's frame: what it shows, for which period and unit, its controls, and its state. */
export function ChartFrame({ title, data, controls, state = { status: 'ready' }, children, headingLevel = 3 }: { title: ReactNode; data: Pick<ChartData, 'period' | 'format'>; controls?: ReactNode; state?: ChartState; children: ReactNode; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <figure data-slot="chart" className="m-0 flex min-w-0 flex-col gap-2">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <figcaption className="min-w-0"><Heading className="text-sm font-semibold">{title}</Heading><p className="text-xs text-muted">{data.period} · {describeFormat(data.format)}</p></figcaption>
      {controls ? <div className="flex flex-wrap items-center gap-2">{controls}</div> : null}
    </div>
    {state.status === 'ready' ? children : <ChartStateMessage state={state} />}
  </figure>;
}

/** Empty, loading and unavailable are different facts and read differently; none draws sample values. */
export function ChartStateMessage({ state }: { state: Exclude<ChartState, { status: 'ready' }> }) {
  const Icon = state.status === 'loading' ? Loader2 : state.status === 'empty' ? Inbox : CircleAlert;
  return <div role={state.status === 'empty' ? undefined : 'status'} data-state={state.status} className="flex min-h-24 items-center justify-center gap-2 px-4 py-6 text-center text-sm text-muted">
    <Icon aria-hidden className={cx('size-4 shrink-0', state.status === 'loading' && 'motion-safe:animate-spin')} />
    <span>{state.status === 'loading' ? 'Loading…' : state.message}</span>
  </div>;
}

export function ChartLegend({ data, kind = 'line', patternFor }: { data: ChartData; kind?: 'line' | 'bar'; patternFor?: (index: number) => string }) {
  if (data.series.length < 2) return null;
  return <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
    {data.series.map((series, index) => <li key={series.id} className="flex items-center gap-1.5">
      {kind === 'line' ? <svg aria-hidden width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={seriesColor(index)} strokeWidth="2.5" strokeDasharray={seriesDash(index)} /></svg>
        : <svg aria-hidden width="12" height="12"><rect x="0.5" y="0.5" width="11" height="11" fill={patternFor?.(index) ?? seriesColor(index)} stroke={seriesColor(index)} /></svg>}{series.label}
    </li>)}
  </ul>;
}

/** The values as a table: the keyboard and screen-reader equivalent of every presentation, and a presentation in its own right. */
export function ChartDataTable({ title, data }: { title: ReactNode; data: ChartData }) {
  return <div className="min-w-0 overflow-x-auto">
    <table className="w-full text-sm">
      <caption className="sr-only">{title}, {data.period}, {describeFormat(data.format)}</caption>
      <thead><tr className="border-b border-border text-xs text-muted"><th scope="col" className="py-1.5 pr-3 text-left font-medium">{data.categoryLabel}</th>{data.series.map(series => <th key={series.id} scope="col" className="py-1.5 pl-3 text-right font-medium">{series.label}</th>)}</tr></thead>
      <tbody>{data.categories.map((category, row) => <tr key={category.key} className="border-b border-border last:border-0">
        <th scope="row" className="py-1.5 pr-3 text-left font-normal">{category.href ? <Link href={category.href} className={cx('underline-offset-4 hover:underline', FOCUS_RING)}>{category.label}</Link> : category.label}</th>
        {data.series.map(series => { const point = series.points[row]; return <td key={series.id} className={cx('py-1.5 pl-3 text-right tabular-nums', point?.value === null && 'text-muted', (point?.value ?? 0) < 0 && 'text-danger')}>{point?.label ?? '—'}</td>; })}
      </tr>)}</tbody>
    </table>
  </div>;
}

type Geometry = { x: number; y: number; w: number; h: number };

/**
 * Line, vertical bar, horizontal bar and stacked bar over one measured SVG. The plot is one focus
 * stop: arrow keys move between categories, the tooltip shows the exact labels, Enter opens a
 * category's authorized destination, and Escape hides the tooltip without leaving the chart.
 * When every category carries a date (`at`), positions follow real time, so sparse days stay apart.
 */
export function CartesianChart({ title, data, presentation, height = 'standard' }: { title: string; data: ChartData; presentation: Exclude<ChartPresentation, 'donut' | 'table'>; height?: ChartHeight }) {
  const [ref, { width, height: plotHeight }] = useSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const router = useRouter();
  const describedBy = useId();
  const horizontal = presentation === 'horizontal-bar';
  const stacked = presentation === 'stacked-bar';
  const count = data.categories.length;
  const values = data.series.flatMap(series => series.points.map(point => point.value ?? 0));
  const stackTotals = data.categories.map((_, row) => data.series.reduce((sum, series) => sum + Math.max(0, series.points[row]?.value ?? 0), 0));
  const min = stacked ? 0 : Math.min(0, ...values), max = stacked ? Math.max(0, ...stackTotals) : Math.max(0, ...values);
  const valueTicks = niceTicks(min, max, Math.max(2, Math.floor((horizontal ? width : plotHeight) / (horizontal ? 90 : 44))));
  const tickLabels = valueTicks.map(tick => formatTick(tick, data.format));
  const longestTick = Math.max(...tickLabels.map(label => label.length));
  const longestCategory = Math.max(0, ...data.categories.map(category => (category.short ?? category.label).length));
  const left = horizontal ? Math.min(width * 0.4, longestCategory * 6.5 + 12) : Math.min(width * 0.3, longestTick * 6.5 + 10);
  const margin = { top: 8, right: horizontal ? Math.max(12, longestTick * 3.4) : 8, bottom: horizontal ? 22 : 24, left };
  const plotW = Math.max(0, width - margin.left - margin.right), plotH = Math.max(0, plotHeight - margin.top - margin.bottom);
  const domain: [number, number] = [valueTicks[0], valueTicks[valueTicks.length - 1]];
  const valuePos = horizontal ? linearScale(domain, [margin.left, margin.left + plotW]) : linearScale(domain, [margin.top + plotH, margin.top]);
  const timed = !horizontal && count > 1 && data.categories.every(category => category.at);
  const times = timed ? data.categories.map(category => Date.parse(category.at!)) : [];
  const timePos = timed ? linearScale([Math.min(...times), Math.max(...times)], [margin.left + 12, margin.left + plotW - 12]) : null;
  const band = (horizontal ? plotH : plotW) / Math.max(1, count);
  const minGap = timed ? Math.min(...times.slice(1).map((time, i) => (timePos!(time) - timePos!(times[i])))) : band;
  const slot = Math.max(4, Math.min(band, minGap || band));
  const centre = (row: number) => timed ? timePos!(times[row]) : (horizontal ? margin.top : margin.left) + band * row + band / 2;
  const zero = valuePos(0);
  const stride = labelStride(count, plotH, 20);
  // Along a horizontal axis, a label is drawn in full only where it does not run into the previous one; the last is preferred.
  const shownX = new Set<number>();
  if (!horizontal) {
    const textWidth = (row: number) => (data.categories[row].short ?? data.categories[row].label).length * 6.5 + 10;
    let lastEdge = -Infinity;
    const order = count > 1 ? [...Array(count).keys()] : [0];
    for (const row of order) { const half = textWidth(row) / 2; if (centre(row) - half >= lastEdge && centre(row) + half <= width) { shownX.add(row); lastEdge = centre(row) + half; } }
    if (count > 1 && !shownX.has(count - 1)) { const half = textWidth(count - 1) / 2; const previous = Math.max(...[...shownX].filter(row => centre(row) + textWidth(row) / 2 > centre(count - 1) - half)); if (Number.isFinite(previous)) shownX.delete(previous); shownX.add(count - 1); }
  }
  const bars: (Geometry & { series: number; row: number; negative: boolean })[] = [];
  if (presentation !== 'line') data.categories.forEach((_, row) => {
    let offset = 0;
    data.series.forEach((series, index) => {
      const value = series.points[row]?.value;
      if (value === null || value === undefined) return;
      // Bars stay readable but never slab-like when there are only a few categories.
      const thickness = Math.min(stacked ? slot * 0.7 : (slot * 0.75) / data.series.length, 28);
      const start = stacked ? valuePos(offset) : zero, end = valuePos(stacked ? offset + Math.max(0, value) : value);
      if (stacked) offset += Math.max(0, value);
      const across = stacked ? centre(row) - thickness / 2 : centre(row) - (thickness * data.series.length) / 2 + thickness * index;
      bars.push(horizontal
        ? { x: Math.min(start, end), y: across, w: Math.abs(end - start), h: thickness, series: index, row, negative: value < 0 }
        : { x: across, y: Math.min(start, end), w: thickness, h: Math.abs(end - start), series: index, row, negative: value < 0 });
    });
  });
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (active === null ? 0 : Math.min(count - 1, active + 1))
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (active === null ? count - 1 : Math.max(0, active - 1))
      : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
    if (next !== null) { event.preventDefault(); setActive(next); return; }
    if (event.key === 'Escape' && active !== null) { event.preventDefault(); event.stopPropagation(); setActive(null); return; }
    if (event.key === 'Enter' && active !== null && data.categories[active].href) router.push(data.categories[active].href!);
  };
  const nearest = (clientX: number, clientY: number) => {
    const box = ref.current!.getBoundingClientRect();
    const position = horizontal ? clientY - box.top : clientX - box.left;
    let best = 0;
    for (let row = 1; row < count; row++) if (Math.abs(centre(row) - position) < Math.abs(centre(best) - position)) best = row;
    return best;
  };
  const tip = active === null ? null : { category: data.categories[active], at: centre(active) };
  const uid = useId().replace(/:/g, '');
  // Later series are hatched as well as tinted, so bars never differ by colour alone.
  const barFill = (index: number) => index === 0 ? seriesColor(0) : `url(#${uid}-hatch-${index})`;
  return <div className="flex min-w-0 flex-col gap-2">
    <ChartLegend data={data} kind={presentation === 'line' ? 'line' : 'bar'} patternFor={barFill} />
    <div ref={ref} tabIndex={0} role="group" aria-roledescription="chart" aria-label={`${title}. Use arrow keys to read values${data.categories.some(c => c.href) ? '; Enter opens the selected item' : ''}.`} aria-describedby={describedBy}
      onKeyDown={move} onBlur={() => setActive(null)} onPointerMove={event => setActive(nearest(event.clientX, event.clientY))} onPointerLeave={() => setActive(null)}
      onClick={event => { const row = nearest(event.clientX, event.clientY); if (data.categories[row].href) router.push(data.categories[row].href!); }}
      className={cx('relative w-full min-w-0 overflow-hidden rounded-sm', HEIGHT[height], data.categories.some(c => c.href) && 'cursor-pointer', FOCUS_RING)}>
      {width > 0 ? <svg width={width} height={plotHeight} className="block text-muted" aria-hidden>
        <defs>{data.series.map((_, index) => index === 0 ? null : <pattern key={index} id={`${uid}-hatch-${index}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={`rotate(${index % 2 ? 45 : -45})`}><rect width="6" height="6" fill={seriesColor(index)} opacity="0.35" /><line x1="0" y1="0" x2="0" y2="6" stroke={seriesColor(index)} strokeWidth="3" /></pattern>)}</defs>
        {valueTicks.map((tick, index) => { const at = valuePos(tick); return <g key={tick}>
          {horizontal ? <line x1={at} x2={at} y1={margin.top} y2={margin.top + plotH} stroke="var(--border)" strokeWidth={tick === 0 ? 1.5 : 1} />
            : <line x1={margin.left} x2={margin.left + plotW} y1={at} y2={at} stroke="var(--border)" strokeWidth={tick === 0 ? 1.5 : 1} />}
          {horizontal ? <text x={at} y={plotHeight - 6} textAnchor="middle" fontSize="11" fill="currentColor">{tickLabels[index]}</text>
            : <text x={margin.left - 6} y={at + 4} textAnchor="end" fontSize="11" fill="currentColor">{tickLabels[index]}</text>}
        </g>; })}
        {data.categories.map((category, row) => horizontal
          ? (row % stride !== 0 && row !== count - 1 ? null : <text key={category.key} x={margin.left - 6} y={centre(row) + 4} textAnchor="end" fontSize="11" fill="currentColor">{clip(category.short ?? category.label, Math.floor((margin.left - 10) / 6.5))}</text>)
          : (!shownX.has(row) ? null : <text key={category.key} x={centre(row)} y={plotHeight - 6} textAnchor="middle" fontSize="11" fill="currentColor">{clip(category.short ?? category.label, Math.floor(plotW / 6.5))}</text>))}
        {active !== null ? (horizontal ? <rect x={margin.left} y={centre(active) - slot / 2} width={plotW} height={slot} fill="var(--foreground)" opacity="0.05" />
          : <rect x={centre(active) - slot / 2} y={margin.top} width={slot} height={plotH} fill="var(--foreground)" opacity="0.05" />) : null}
        {bars.map(bar => <rect key={`${bar.series}-${bar.row}`} x={bar.x} y={bar.y} width={Math.max(bar.w, bar.w === 0 ? 0 : 1)} height={Math.max(bar.h, bar.h === 0 ? 0 : 1)} fill={barFill(bar.series)} opacity={active === null || active === bar.row ? 1 : 0.55} stroke={bar.series === 0 ? 'var(--surface, var(--background))' : seriesColor(bar.series)} strokeWidth={stacked || bar.series > 0 ? 1 : 0} />)}
        {presentation === 'line' ? data.series.map((series, index) => {
          const segments: string[] = []; let open = false;
          series.points.forEach((point, row) => { if (point.value === null) { open = false; return; } segments.push(`${open ? 'L' : 'M'}${centre(row)},${valuePos(point.value)}`); open = true; });
          return <g key={series.id}>
            <path d={segments.join(' ')} fill="none" stroke={seriesColor(index)} strokeWidth="2" strokeDasharray={seriesDash(index)} strokeLinejoin="round" />
            {series.points.map((point, row) => point.value === null ? null : <Marker key={row} shape={MARKERS[index % MARKERS.length]} x={centre(row)} y={valuePos(point.value)} color={seriesColor(index)} size={active === row ? 4.5 : 3} />)}
          </g>;
        }) : null}
      </svg> : null}
      {tip && width > 0 ? <div role="presentation" className="pointer-events-none absolute z-10 max-w-[16rem] rounded-[var(--visual-radius,0.625rem)] border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[var(--visual-overlay-shadow)]"
        style={horizontal ? { top: Math.min(tip.at + 8, plotHeight - 60), left: margin.left + 8 } : { left: Math.min(Math.max(4, tip.at - 80), width - 168), top: 4 }}>
        <p className="font-medium">{tip.category.label}</p>
        {data.series.map((series, index) => <p key={series.id} className="flex justify-between gap-3 tabular-nums"><span className="flex items-center gap-1">{data.series.length > 1 ? <svg aria-hidden width="10" height="10"><rect width="10" height="10" fill={seriesColor(index)} /></svg> : null}{data.series.length > 1 ? series.label : describeFormat(data.format)}</span><span>{series.points[active!]?.label ?? '—'}</span></p>)}
      </div> : null}
    </div>
    <p id={describedBy} aria-live="polite" className="sr-only">{tip ? `${tip.category.label}: ${data.series.map(series => `${data.series.length > 1 ? `${series.label} ` : ''}${series.points[active!]?.label ?? 'no value'}`).join(', ')}` : ''}</p>
  </div>;
}

function clip(text: string, max: number) { return max < 2 ? '' : text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text; }

function Marker({ shape, x, y, color, size }: { shape: (typeof MARKERS)[number]; x: number; y: number; color: string; size: number }) {
  if (shape === 'square') return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} fill={color} />;
  if (shape === 'triangle') return <path d={`M${x},${y - size * 1.2} L${x + size * 1.1},${y + size} L${x - size * 1.1},${y + size} Z`} fill={color} />;
  if (shape === 'diamond') return <path d={`M${x},${y - size * 1.3} L${x + size * 1.3},${y} L${x},${y + size * 1.3} L${x - size * 1.3},${y} Z`} fill={color} />;
  return <circle cx={x} cy={y} r={size} fill={color} />;
}

/**
 * Parts of one whole as one bar split into segments, each labelled with its exact value. Used for a
 * single-series composition's Stacked bars, where separate bars would hide that they share a total.
 */
export function PartsBar({ title, data }: { title: string; data: ChartData }) {
  const points = data.series[0]?.points ?? [];
  const total = points.reduce((sum, point) => sum + Math.max(0, point.value ?? 0), 0);
  return <div className="flex min-w-0 flex-col gap-3">
    <div role="img" aria-label={`${title}: ${data.categories.map((category, row) => `${category.label} ${points[row]?.label}`).join(', ')}`} className="flex h-6 w-full overflow-hidden rounded-sm border border-border">
      {points.map((point, row) => { const share = total ? Math.max(0, point.value ?? 0) / total : 0; return share > 0 ? <span key={row} className="h-full border-r border-[var(--surface,var(--background))] last:border-r-0" style={{ width: `${share * 100}%`, background: row % 2 ? `repeating-linear-gradient(45deg, ${seriesColor(row)} 0 3px, transparent 3px 6px)` : seriesColor(row) }} /> : null; })}
    </div>
    <ul aria-hidden className="grid gap-1 text-xs sm:grid-cols-2">{data.categories.map((category, row) => <li key={category.key} className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5"><span className="size-2.5 shrink-0 border" style={{ borderColor: seriesColor(row), background: row % 2 ? `repeating-linear-gradient(45deg, ${seriesColor(row)} 0 2px, transparent 2px 4px)` : seriesColor(row) }} /><span className="truncate">{category.label}</span></span>
      <span className="tabular-nums">{points[row]?.label}</span>
    </li>)}</ul>
  </div>;
}

/** Parts of one whole, one series, non-negative and known (`allowedPresentations` refuses anything else). Each part is labelled in the legend with its exact value. */
export function DonutChart({ title, data, height = 'standard' }: { title: string; data: ChartData; height?: ChartHeight }) {
  const [ref, { width, height: plotHeight }] = useSize<HTMLDivElement>();
  const points = data.series[0]?.points ?? [];
  const total = points.reduce((sum, point) => sum + Math.max(0, point.value ?? 0), 0);
  const radius = Math.max(0, Math.min(width, plotHeight) / 2 - 4), inner = radius * 0.6;
  const shares = points.map(point => total ? Math.max(0, point.value ?? 0) / total : 0);
  const arcs = shares.map((share, row) => {
    const start = -Math.PI / 2 + shares.slice(0, row).reduce((sum, part) => sum + part, 0) * Math.PI * 2;
    return { row, share, start, end: start + share * Math.PI * 2 };
  });
  const cx0 = width / 2, cy0 = plotHeight / 2;
  const at = (r: number, a: number) => `${cx0 + r * Math.cos(a)},${cy0 + r * Math.sin(a)}`;
  return <div className="grid min-w-0 gap-3 @min-[28rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div ref={ref} role="img" aria-label={`${title}: ${data.categories.map((category, row) => `${category.label} ${points[row]?.label}`).join(', ')}`} className={cx('min-w-0', HEIGHT[height])}>
      {width > 0 ? <svg width={width} height={plotHeight} aria-hidden>{arcs.map(arc => arc.share <= 0 ? null : arc.share >= 0.9999
        ? <circle key={arc.row} cx={cx0} cy={cy0} r={(radius + inner) / 2} fill="none" stroke={seriesColor(arc.row)} strokeWidth={radius - inner} />
        : <path key={arc.row} d={`M${at(radius, arc.start)} A${radius},${radius} 0 ${arc.end - arc.start > Math.PI ? 1 : 0} 1 ${at(radius, arc.end)} L${at(inner, arc.end)} A${inner},${inner} 0 ${arc.end - arc.start > Math.PI ? 1 : 0} 0 ${at(inner, arc.start)} Z`} fill={seriesColor(arc.row)} stroke="var(--surface, var(--background))" strokeWidth="1.5" />)}</svg> : null}
    </div>
    <ul aria-hidden className="flex flex-col justify-center gap-1 text-xs">{data.categories.map((category, row) => <li key={category.key} className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5"><svg width="10" height="10"><rect width="10" height="10" fill={seriesColor(row)} /></svg><span className="truncate">{category.label}</span></span>
      <span className="tabular-nums">{points[row]?.label}</span>
    </li>)}</ul>
  </div>;
}

/**
 * One chart with its presentation menu. Only presentations valid for the data are offered, and every
 * one draws the same values; a stale or invalid choice falls back to the shape's default. `variants`
 * lets a person choose between separately valid datasets (one per currency, for instance) — never
 * a combination of them. Below any drawn presentation the same values are available as a table.
 */
export function Chart({ title, data, variants, variant, onVariantChange, presentation: requested, onPresentationChange, state, height = 'standard', headingLevel }: {
  title: string; data: ChartData; state?: ChartState; height?: ChartHeight; headingLevel?: 2 | 3;
  variants?: { key: string; label: string }[]; variant?: string; onVariantChange?: (key: string) => void;
  presentation?: string | null; onPresentationChange?: (presentation: ChartPresentation) => void;
}) {
  const id = useId();
  const allowed = allowedPresentations(data);
  // Controlled when an owner persists the choice; otherwise this chart remembers it for the visit.
  const [local, setLocal] = useState<string | null | undefined>(requested);
  const presentation = resolvePresentation(data, onPresentationChange ? requested : local);
  const ready = state ?? (hasValues(data) ? { status: 'ready' as const } : { status: 'empty' as const, message: 'Nothing recorded for this period.' });
  const controls = <>
    {variants && variants.length > 1 ? <label className="flex items-center gap-1.5 text-xs text-muted"><span className="sr-only">{title}: </span>Currency<SelectInput aria-label={`${title} currency`} size="small" value={variant} onChange={event => onVariantChange?.(event.target.value)} className="w-24">{variants.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</SelectInput></label> : null}
    {allowed.length > 1 && ready.status === 'ready' ? <label htmlFor={`${id}-presentation`} className="flex items-center gap-1.5 text-xs text-muted"><span className="sr-only">{title}: </span>Show as
      <SelectInput id={`${id}-presentation`} aria-label={`${title} presentation`} size="small" value={presentation} onChange={event => { setLocal(event.target.value); onPresentationChange?.(event.target.value as ChartPresentation); }} className="w-40">{allowed.map(option => <option key={option} value={option}>{PRESENTATION_LABEL[option]}</option>)}</SelectInput></label> : null}
  </>;
  return <ChartFrame title={title} data={data} controls={controls} state={ready} headingLevel={headingLevel}>
    {presentation === 'table' ? <ChartDataTable title={title} data={data} />
      : <>{presentation === 'donut' ? <DonutChart title={title} data={data} height={height} /> : presentation === 'stacked-bar' && data.series.length === 1 ? <PartsBar title={title} data={data} /> : <CartesianChart title={title} data={data} presentation={presentation} height={height} />}
        <details className="text-xs"><summary className={cx('w-fit cursor-pointer text-muted', FOCUS_RING)}>View as table</summary><div className="mt-2"><ChartDataTable title={title} data={data} /></div></details></>}
  </ChartFrame>;
}
