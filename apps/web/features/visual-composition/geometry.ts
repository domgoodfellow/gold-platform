/**
 * Fragment geometry for a composition: one definition per group, never per card.
 *
 * A layout says which grid area each fragment occupies. `deriveGeometry` turns that into
 * complementary outlines whose shared edges are the same points seen from both sides, so two
 * neighbours can never leave a gap, overlap or disagree about where their seam runs. Seams are
 * the edges two fragments share; the rest of an outline is the composition's own boundary.
 *
 * Coordinates are grid units (one column wide, one row tall). The rendered grid uses equal
 * columns and equal rows, so a unit maps to an exact percentage of the group's box and the
 * outlines line up with the HTML cells that hold the content.
 */

export type Point = readonly [x: number, y: number];

/** Column, row (both from 0), column span, row span. */
export type GridArea = readonly [column: number, row: number, columns: number, rows: number];

export interface FragmentLayout {
  columns: number;
  rows: number;
  areas: Readonly<Record<string, GridArea>>;
  /**
   * How far a joint may wander from the grid line, in units of each axis, and a seed that makes
   * the wandering deterministic. The same layout and seed always produce the same geometry, on the
   * server and in every browser.
   */
  irregularity?: { x: number; y: number; seed: string };
}

export interface FragmentGeometry {
  columns: number;
  rows: number;
  /** Clockwise outline of each fragment, in grid units. */
  outlines: Record<string, Point[]>;
  /** Every boundary two fragments share, as continuous polylines. */
  seams: Point[][];
  /** Each fragment's edges on the composition's outer boundary, as continuous polylines. */
  edges: Record<string, Point[][]>;
}

const DEFAULT_IRREGULARITY = { x: 0.12, y: 0.08, seed: 'composition' };

/** A stable value in [-1, 1] for a key: FNV-1a, then scaled. Not random, never time-dependent. */
function wobble(seed: string, key: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${seed}:${key}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Which area owns each unit cell. Throws when the areas do not tile the grid exactly once. */
export function ownership(layout: FragmentLayout): string[][] {
  const owners: (string | undefined)[][] = Array.from({ length: layout.columns }, () => Array<string | undefined>(layout.rows).fill(undefined));
  for (const [id, [column, row, columns, rows]] of Object.entries(layout.areas)) {
    if (columns < 1 || rows < 1 || column < 0 || row < 0 || column + columns > layout.columns || row + rows > layout.rows) {
      throw new Error(`Fragment "${id}" lies outside its ${layout.columns}×${layout.rows} grid.`);
    }
    for (let x = column; x < column + columns; x += 1) {
      for (let y = row; y < row + rows; y += 1) {
        if (owners[x]![y] !== undefined) throw new Error(`Fragments "${owners[x]![y]}" and "${id}" overlap at ${x},${y}.`);
        owners[x]![y] = id;
      }
    }
  }
  owners.forEach((column, x) => column.forEach((owner, y) => {
    if (owner === undefined) throw new Error(`No fragment covers ${x},${y}.`);
  }));
  return owners as string[][];
}

export function deriveGeometry(layout: FragmentLayout): FragmentGeometry {
  const owners = ownership(layout);
  const { columns, rows } = layout;
  const { x: wanderX, y: wanderY, seed } = layout.irregularity ?? DEFAULT_IRREGULARITY;
  const ownerAt = (x: number, y: number) => (x >= 0 && y >= 0 && x < columns && y < rows ? owners[x]![y] : undefined);

  /** A lattice point, moved within its allowance. Points on the outer boundary only slide along it. */
  const vertex = (x: number, y: number): Point => {
    const onSide = x === 0 || x === columns;
    const onEnd = y === 0 || y === rows;
    const dx = onSide ? 0 : wobble(seed, `vx${x},${y}`) * wanderX;
    const dy = onEnd ? 0 : wobble(seed, `vy${x},${y}`) * wanderY;
    return [round(x + dx), round(y + dy)];
  };

  /** One kink part-way along a unit edge, pushed sideways; shared by both fragments that meet there. */
  const kink = (x1: number, y1: number, x2: number, y2: number): Point | null => {
    const horizontal = y1 === y2;
    const interior = horizontal ? y1 > 0 && y1 < rows : x1 > 0 && x1 < columns;
    if (!interior) return null;
    const key = `k${Math.min(x1, x2)},${Math.min(y1, y2)}${horizontal ? 'h' : 'v'}`;
    const along = 0.5 + wobble(seed, `${key}a`) * 0.18;
    // Measured from the lower end whichever way the edge is walked, so both neighbours agree.
    const [ax, ay] = vertex(Math.min(x1, x2), Math.min(y1, y2));
    const [bx, by] = vertex(Math.max(x1, x2), Math.max(y1, y2));
    const sideways = wobble(seed, `${key}s`) * (horizontal ? wanderY : wanderX) * 1.4;
    return horizontal
      ? [round(ax + (bx - ax) * along), round(ay + (by - ay) * along + sideways)]
      : [round(ax + (bx - ax) * along + sideways), round(ay + (by - ay) * along)];
  };

  /** The points of a unit edge after its start, in travel direction. */
  const step = (x1: number, y1: number, x2: number, y2: number): Point[] => {
    const middle = kink(x1, y1, x2, y2);
    return middle ? [middle, vertex(x2, y2)] : [vertex(x2, y2)];
  };

  const outlines: Record<string, Point[]> = {};
  const edges: Record<string, Point[][]> = {};
  for (const [id, [column, row, width, height]] of Object.entries(layout.areas)) {
    const left = column;
    const top = row;
    const right = column + width;
    const bottom = row + height;
    const outline: Point[] = [vertex(left, top)];
    const outer: Point[][] = [];
    const current: { run: Point[] | null } = { run: null };
    const walk = (x1: number, y1: number, x2: number, y2: number, outsideX: number, outsideY: number) => {
      const points = step(x1, y1, x2, y2);
      outline.push(...points);
      if (ownerAt(outsideX, outsideY) === undefined) {
        current.run ??= [vertex(x1, y1)];
        current.run.push(...points);
      } else if (current.run) {
        outer.push(current.run);
        current.run = null;
      }
    };
    for (let x = left; x < right; x += 1) walk(x, top, x + 1, top, x, top - 1);
    for (let y = top; y < bottom; y += 1) walk(right, y, right, y + 1, right, y);
    for (let x = right; x > left; x -= 1) walk(x, bottom, x - 1, bottom, x - 1, bottom);
    for (let y = bottom; y > top; y -= 1) walk(left, y, left, y - 1, left - 1, y - 1);
    if (current.run) outer.push(current.run);
    outline.pop(); // The walk ends where it began.
    outlines[id] = outline;
    edges[id] = joinRuns(outer);
  }

  return { columns, rows, outlines, seams: seamChains(owners, columns, rows, vertex, step), edges };
}

/** A closed walk may split one boundary run across its starting corner; rejoin it. */
function joinRuns(runs: Point[][]): Point[][] {
  if (runs.length < 2) return runs;
  const first = runs[0]!;
  const last = runs.at(-1)!;
  const [fx, fy] = first[0]!;
  const [lx, ly] = last.at(-1)!;
  if (fx === lx && fy === ly) return [[...last, ...first.slice(1)], ...runs.slice(1, -1)];
  return runs;
}

/** Every unit edge with a different fragment on each side, chained through lattice points of degree two. */
function seamChains(
  owners: string[][],
  columns: number,
  rows: number,
  vertex: (x: number, y: number) => Point,
  step: (x1: number, y1: number, x2: number, y2: number) => Point[],
): Point[][] {
  type Edge = { a: string; b: string; ax: number; ay: number; bx: number; by: number };
  const shared: Edge[] = [];
  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      if (x + 1 < columns && owners[x]![y] !== owners[x + 1]![y]) shared.push({ a: `${x + 1},${y}`, b: `${x + 1},${y + 1}`, ax: x + 1, ay: y, bx: x + 1, by: y + 1 });
      if (y + 1 < rows && owners[x]![y] !== owners[x]![y + 1]) shared.push({ a: `${x},${y + 1}`, b: `${x + 1},${y + 1}`, ax: x, ay: y + 1, bx: x + 1, by: y + 1 });
    }
  }
  const touching = new Map<string, Edge[]>();
  for (const edge of shared) {
    for (const end of [edge.a, edge.b]) touching.set(end, [...(touching.get(end) ?? []), edge]);
  }
  const used = new Set<Edge>();
  const chains: Point[][] = [];
  const extend = (from: string, edge: Edge): { points: Point[]; end: string } => {
    const forward = edge.a === from;
    const points = forward ? step(edge.ax, edge.ay, edge.bx, edge.by) : step(edge.bx, edge.by, edge.ax, edge.ay);
    return { points, end: forward ? edge.b : edge.a };
  };
  // Start at ends and junctions first, so each chain runs from one joint to the next.
  const starts = [...touching.keys()].sort((p, q) => Number(touching.get(p)!.length === 2) - Number(touching.get(q)!.length === 2));
  for (const start of starts) {
    for (const first of touching.get(start)!) {
      if (used.has(first)) continue;
      const [sx, sy] = start.split(',').map(Number) as [number, number];
      const chain: Point[] = [vertex(sx, sy)];
      let at = start;
      let edge: Edge | undefined = first;
      while (edge && !used.has(edge)) {
        used.add(edge);
        const { points, end } = extend(at, edge);
        chain.push(...points);
        at = end;
        const next: Edge[] = touching.get(at)!.filter((candidate) => !used.has(candidate));
        edge = touching.get(at)!.length === 2 ? next[0] : undefined;
      }
      chains.push(chain);
    }
  }
  return chains;
}

/** Area of a closed outline (shoelace), positive when the outline runs clockwise on screen. */
export function outlineArea(points: readonly Point[]): number {
  let sum = 0;
  points.forEach(([x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  });
  return sum / 2;
}

export function chainLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  }
  return length;
}

const percent = (value: number, of: number) => `${round((value / of) * 100)}%`;

/** A fragment's outline as a CSS `clip-path`, relative to the whole group's box. */
export function clipPath(geometry: FragmentGeometry, id: string): string {
  const outline = geometry.outlines[id];
  if (!outline) throw new Error(`No fragment "${id}".`);
  return `polygon(${outline.map(([x, y]) => `${percent(x, geometry.columns)} ${percent(y, geometry.rows)}`).join(', ')})`;
}

/** A polyline as SVG path data in the geometry's own units. */
export function pathData(points: readonly Point[]): string {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
}
