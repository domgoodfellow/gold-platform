import { chainLength, deriveGeometry, type FragmentGeometry, type FragmentLayout } from './geometry';

/**
 * The widths a composition is arranged for, measured on the composition itself (a container
 * query), not the viewport: the same composition can sit full-width or beside other content.
 * Each width gets its own arrangement; nothing is a scaled copy of the desktop layout.
 */
export const BREAKPOINTS = ['compact', 'medium', 'wide'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** Where `medium` and `wide` begin. visual-composition.css repeats these in its container queries. */
export const BREAKPOINT_MIN_REM: Record<Breakpoint, number> = { compact: 0, medium: 40, wide: 64 };

/**
 * A named arrangement of fragments. Every width places the same fragments; content is bound to
 * a fragment by name, so the arrangement can change without the content knowing.
 */
export interface Composition {
  name: string;
  layouts: Record<Breakpoint, FragmentLayout>;
  /** How many of the longest seams catch a moving reflection when the composition is in focus. */
  shimmer?: number;
}

export interface ResolvedLayout {
  layout: FragmentLayout;
  geometry: FragmentGeometry;
  /** Indexes into `geometry.seams` of the seams that shimmer. */
  shimmer: number[];
}

export function fragmentIds(composition: Composition): string[] {
  return Object.keys(composition.layouts.wide.areas);
}

const resolved = new Map<Composition, Record<Breakpoint, ResolvedLayout>>();

/** Geometry for every width. Derived once per composition object and reused. */
export function resolveComposition(composition: Composition): Record<Breakpoint, ResolvedLayout> {
  const cached = resolved.get(composition);
  if (cached) return cached;
  const ids = fragmentIds(composition).sort().join(',');
  const result = Object.fromEntries(BREAKPOINTS.map((breakpoint) => {
    const layout = composition.layouts[breakpoint];
    if (Object.keys(layout.areas).sort().join(',') !== ids) {
      throw new Error(`Composition "${composition.name}" places different fragments at ${breakpoint} width.`);
    }
    const geometry = deriveGeometry({ ...layout, irregularity: layout.irregularity ?? { x: 0.12, y: 0.08, seed: `${composition.name}-${breakpoint}` } });
    const shimmer = geometry.seams
      .map((seam, index) => ({ index, length: chainLength(seam) }))
      .sort((a, b) => b.length - a.length)
      .slice(0, composition.shimmer ?? 1)
      .map(({ index }) => index);
    return [breakpoint, { layout, geometry, shimmer }];
  })) as Record<Breakpoint, ResolvedLayout>;
  resolved.set(composition, result);
  return result;
}
