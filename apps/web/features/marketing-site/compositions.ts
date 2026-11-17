import type { Composition } from '@/features/visual-composition/composition';
import type { OfferingGroupKey } from '@/lib/marketing/content';

/**
 * GildOps' homepage arrangements. Each section has its own: shared mechanics (geometry, seams,
 * light), different shapes, densities and hierarchies. Areas are [column, row, columns, rows];
 * every width places the same fragments, arranged for that width rather than scaled.
 *
 * Fragment names are roles, not content: the homepage binds published sections to them.
 */

/** Hero: the opening copy on open ground, beside a cluster of the three product groups. */
export const HERO: Composition = {
  name: 'hero',
  shimmer: 2,
  layouts: {
    wide: {
      columns: 12,
      rows: 4,
      irregularity: { x: 0.14, y: 0.1, seed: 'hero-wide' },
      areas: { copy: [0, 0, 6, 4], first: [6, 0, 3, 2], accent: [9, 0, 3, 1], second: [9, 1, 3, 2], third: [6, 2, 3, 2], base: [9, 3, 3, 1] },
    },
    medium: {
      columns: 6,
      rows: 3,
      irregularity: { x: 0.1, y: 0.09, seed: 'hero-medium' },
      areas: { copy: [0, 0, 5, 2], accent: [5, 0, 1, 1], base: [5, 1, 1, 1], first: [0, 2, 2, 1], second: [2, 2, 2, 1], third: [4, 2, 2, 1] },
    },
    compact: {
      columns: 3,
      rows: 6,
      irregularity: { x: 0.1, y: 0.07, seed: 'hero-compact' },
      areas: { copy: [0, 0, 3, 3], first: [0, 3, 3, 1], second: [0, 4, 2, 1], accent: [2, 4, 1, 1], third: [0, 5, 2, 1], base: [2, 5, 1, 1] },
    },
  },
};

/** Three products of one group. Each group is arranged differently. */
export const PRODUCT_GROUPS: Record<OfferingGroupKey, Composition> = {
  // Side by side: three equal doors.
  tools: {
    name: 'tools',
    layouts: {
      wide: { columns: 3, rows: 1, irregularity: { x: 0.05, y: 0.05, seed: 'tools-wide' }, areas: { a: [0, 0, 1, 1], b: [1, 0, 1, 1], c: [2, 0, 1, 1] } },
      medium: { columns: 2, rows: 2, irregularity: { x: 0.06, y: 0.08, seed: 'tools-medium' }, areas: { a: [0, 0, 2, 1], b: [0, 1, 1, 1], c: [1, 1, 1, 1] } },
      compact: { columns: 1, rows: 3, irregularity: { x: 0, y: 0.08, seed: 'tools-compact' }, areas: { a: [0, 0, 1, 1], b: [0, 1, 1, 1], c: [0, 2, 1, 1] } },
    },
  },
  // One leading product with two beside it.
  ai: {
    name: 'ai',
    layouts: {
      wide: { columns: 5, rows: 2, irregularity: { x: 0.08, y: 0.08, seed: 'ai-wide' }, areas: { a: [0, 0, 3, 2], b: [3, 0, 2, 1], c: [3, 1, 2, 1] } },
      medium: { columns: 2, rows: 2, irregularity: { x: 0.06, y: 0.08, seed: 'ai-medium' }, areas: { a: [0, 0, 1, 2], b: [1, 0, 1, 1], c: [1, 1, 1, 1] } },
      compact: { columns: 1, rows: 3, irregularity: { x: 0, y: 0.08, seed: 'ai-compact' }, areas: { a: [0, 0, 1, 1], b: [0, 1, 1, 1], c: [0, 2, 1, 1] } },
    },
  },
  // Connected: two above, one beneath both, meeting at one joint, with a material key at the edge.
  connected: {
    name: 'connected',
    shimmer: 2,
    layouts: {
      wide: { columns: 6, rows: 2, irregularity: { x: 0.1, y: 0.08, seed: 'connected-wide' }, areas: { a: [0, 0, 3, 1], b: [3, 0, 2, 1], key: [5, 0, 1, 2], c: [0, 1, 5, 1] } },
      medium: { columns: 5, rows: 2, irregularity: { x: 0.08, y: 0.08, seed: 'connected-medium' }, areas: { a: [0, 0, 2, 1], b: [2, 0, 2, 1], key: [4, 0, 1, 2], c: [0, 1, 4, 1] } },
      compact: { columns: 4, rows: 3, irregularity: { x: 0.08, y: 0.06, seed: 'connected-compact' }, areas: { a: [0, 0, 4, 1], b: [0, 1, 3, 1], key: [3, 1, 1, 2], c: [0, 2, 3, 1] } },
    },
  },
};

/** Process: a readable sequence of four steps. */
export const PROCESS: Composition = {
  name: 'process',
  layouts: {
    wide: { columns: 4, rows: 1, irregularity: { x: 0.05, y: 0.06, seed: 'process-wide' }, areas: { s1: [0, 0, 1, 1], s2: [1, 0, 1, 1], s3: [2, 0, 1, 1], s4: [3, 0, 1, 1] } },
    medium: { columns: 2, rows: 2, irregularity: { x: 0.06, y: 0.07, seed: 'process-medium' }, areas: { s1: [0, 0, 1, 1], s2: [1, 0, 1, 1], s3: [0, 1, 1, 1], s4: [1, 1, 1, 1] } },
    compact: { columns: 1, rows: 4, irregularity: { x: 0, y: 0.07, seed: 'process-compact' }, areas: { s1: [0, 0, 1, 1], s2: [0, 1, 1, 1], s3: [0, 2, 1, 1], s4: [0, 3, 1, 1] } },
  },
};

/** Trust: the heading on open ground, four statements laid like bricks. */
export const TRUST: Composition = {
  name: 'trust',
  layouts: {
    wide: { columns: 7, rows: 2, irregularity: { x: 0.08, y: 0.07, seed: 'trust-wide' }, areas: { heading: [0, 0, 2, 2], t1: [2, 0, 3, 1], t2: [5, 0, 2, 1], t3: [2, 1, 2, 1], t4: [4, 1, 3, 1] } },
    medium: { columns: 5, rows: 3, irregularity: { x: 0.08, y: 0.07, seed: 'trust-medium' }, areas: { heading: [0, 0, 5, 1], t1: [0, 1, 3, 1], t2: [3, 1, 2, 1], t3: [0, 2, 2, 1], t4: [2, 2, 3, 1] } },
    compact: { columns: 1, rows: 5, irregularity: { x: 0, y: 0.07, seed: 'trust-compact' }, areas: { heading: [0, 0, 1, 1], t1: [0, 1, 1, 1], t2: [0, 2, 1, 1], t3: [0, 3, 1, 1], t4: [0, 4, 1, 1] } },
  },
};

/** Closing: one dominant region, entered by a seam that splits off two quieter pieces. */
export const CLOSING: Composition = {
  name: 'closing',
  shimmer: 2,
  layouts: {
    wide: { columns: 12, rows: 3, irregularity: { x: 0.3, y: 0.12, seed: 'closing-wide' }, areas: { main: [0, 0, 9, 3], upper: [9, 0, 3, 2], lower: [9, 2, 3, 1] } },
    medium: { columns: 8, rows: 3, irregularity: { x: 0.3, y: 0.12, seed: 'closing-medium' }, areas: { main: [0, 0, 6, 3], upper: [6, 0, 2, 2], lower: [6, 2, 2, 1] } },
    compact: { columns: 4, rows: 6, irregularity: { x: 0.25, y: 0.1, seed: 'closing-compact' }, areas: { main: [0, 0, 4, 5], upper: [0, 5, 3, 1], lower: [3, 5, 1, 1] } },
  },
};
