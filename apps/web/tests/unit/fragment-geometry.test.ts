import { describe, expect, it } from 'vitest';
import { deriveGeometry, outlineArea, clipPath, type FragmentLayout, type Point } from '@/features/visual-composition/geometry';
import { BREAKPOINTS, resolveComposition, type Composition } from '@/features/visual-composition/composition';
import { CLOSING, HERO, PROCESS, PRODUCT_GROUPS, TRUST } from '@/features/marketing-site/compositions';

const COMPOSITIONS: Composition[] = [HERO, ...Object.values(PRODUCT_GROUPS), PROCESS, TRUST, CLOSING];
const key = ([x, y]: Point) => `${x},${y}`;

/** Every directed edge of every outline, so shared boundaries can be compared from both sides. */
function directedEdges(outlines: Record<string, Point[]>): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const [id, outline] of Object.entries(outlines)) {
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length]!;
      const edge = `${key(point)}>${key(next)}`;
      edges.set(edge, [...(edges.get(edge) ?? []), id]);
    });
  }
  return edges;
}

describe('fragment geometry is one assembly, not separate cards', () => {
  for (const composition of COMPOSITIONS) {
    for (const breakpoint of BREAKPOINTS) {
      const { layout, geometry, shimmer } = resolveComposition(composition)[breakpoint];

      it(`${composition.name} at ${breakpoint} width tiles its grid with no gap or overlap`, () => {
        const areas = Object.values(geometry.outlines).map(outlineArea);
        for (const area of areas) expect(area).toBeGreaterThan(0);
        expect(areas.reduce((sum, area) => sum + area, 0)).toBeCloseTo(layout.columns * layout.rows, 6);
      });

      it(`${composition.name} at ${breakpoint} width draws seams only where two fragments meet, each seen from both sides`, () => {
        const edges = directedEdges(geometry.outlines);
        expect(geometry.seams.length).toBeGreaterThan(0);
        for (const seam of geometry.seams) {
          for (let index = 1; index < seam.length; index += 1) {
            const forward = edges.get(`${key(seam[index - 1]!)}>${key(seam[index]!)}`) ?? [];
            const backward = edges.get(`${key(seam[index]!)}>${key(seam[index - 1]!)}`) ?? [];
            expect(forward).toHaveLength(1);
            expect(backward).toHaveLength(1);
            expect(forward[0]).not.toBe(backward[0]);
          }
        }
        // And every edge two fragments share is on a seam: nothing is joined without one.
        const seamEdges = new Set(geometry.seams.flatMap((seam) => seam.slice(1).map((point, index) => [key(seam[index]!), key(point)].sort().join('|'))));
        for (const edge of edges.keys()) {
          const [from, to] = edge.split('>') as [string, string];
          if (edges.has(`${to}>${from}`)) expect(seamEdges.has([from, to].sort().join('|')), edge).toBe(true);
        }
      });

      it(`${composition.name} at ${breakpoint} width keeps every joint near its grid line`, () => {
        const { x, y } = layout.irregularity!;
        for (const outline of Object.values(geometry.outlines)) {
          for (const [px, py] of outline) {
            expect(px).toBeGreaterThanOrEqual(0);
            expect(px).toBeLessThanOrEqual(layout.columns);
            expect(py).toBeGreaterThanOrEqual(0);
            expect(py).toBeLessThanOrEqual(layout.rows);
            const offGridX = Math.abs(px - Math.round(px));
            const offGridY = Math.abs(py - Math.round(py));
            // A kink lies part-way along an edge, so only one of its axes is near a line.
            expect(Math.min(offGridX - x * 2.4, offGridY - y * 2.4)).toBeLessThanOrEqual(1e-9);
          }
        }
        for (const index of shimmer) expect(geometry.seams[index]).toBeDefined();
      });
    }
  }

  it('derives the same geometry every time, on any machine', () => {
    const layout: FragmentLayout = { columns: 3, rows: 2, irregularity: { x: 0.1, y: 0.1, seed: 'same' }, areas: { a: [0, 0, 2, 1], b: [2, 0, 1, 2], c: [0, 1, 2, 1] } };
    expect(deriveGeometry(layout)).toEqual(deriveGeometry(structuredClone(layout)));
    expect(clipPath(deriveGeometry(layout), 'a')).toMatch(/^polygon\((-?[\d.]+% -?[\d.]+%, )+-?[\d.]+% -?[\d.]+%\)$/);
  });

  it('refuses layouts that overlap, leave holes or fall outside the grid', () => {
    const base = { columns: 2, rows: 1 } as const;
    expect(() => deriveGeometry({ ...base, areas: { a: [0, 0, 2, 1], b: [1, 0, 1, 1] } })).toThrow(/overlap/);
    expect(() => deriveGeometry({ ...base, areas: { a: [0, 0, 1, 1] } })).toThrow(/No fragment covers/);
    expect(() => deriveGeometry({ ...base, areas: { a: [0, 0, 3, 1] } })).toThrow(/outside/);
  });

  it('refuses a composition that places different fragments at different widths', () => {
    const broken: Composition = {
      name: 'broken',
      layouts: {
        wide: { columns: 2, rows: 1, areas: { a: [0, 0, 1, 1], b: [1, 0, 1, 1] } },
        medium: { columns: 2, rows: 1, areas: { a: [0, 0, 1, 1], b: [1, 0, 1, 1] } },
        compact: { columns: 1, rows: 1, areas: { a: [0, 0, 1, 1] } },
      },
    };
    expect(() => resolveComposition(broken)).toThrow(/different fragments/);
  });
});
