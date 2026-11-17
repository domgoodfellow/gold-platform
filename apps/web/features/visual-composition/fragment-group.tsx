import { Fragment, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/components/class-names';
import { clipPath } from './geometry';
import { BREAKPOINTS, fragmentIds, resolveComposition, type Breakpoint, type Composition } from './composition';
import { SeamNetwork } from './seam-network';

/**
 * A material name from the page's material set (`data-material`). `ground` is the page itself:
 * no surface and no outer edge, though its seams with neighbours are still drawn.
 */
export type Material = string;

export interface FragmentCell {
  /** The fragment, by name, that holds this content at every width. */
  fragment: string;
  content: ReactNode;
  /** When set, the whole cell is this link, so its full surface is the target. */
  href?: string;
  /** Presentation for this cell's content box (typography, padding), never its geometry. */
  className?: string;
  key?: string;
}

/**
 * One connected composition: content cells laid out on the composition's grid, each with a
 * surface clipped to its fragment's outline, plus any purely material fragments and one seam
 * network over all of them.
 *
 * Content is ordinary HTML in reading order, inside the list or block the caller chooses. The
 * surfaces and seams are decoration: hidden from assistive technology, never focusable, never
 * a pointer target. Geometry, material and lighting are independent of what the cells contain.
 *
 * The group is a lit target (`data-lit`) for `LightingController`; without it, or with reduced
 * motion, the static light from the stylesheet applies.
 */
export function FragmentGroup({ id, composition, cells, materials, as = 'div', className, label }: {
  /** Unique on the page; namespaces the seam gradients. */
  id: string;
  composition: Composition;
  cells: FragmentCell[];
  /** Material for every fragment of the composition, content or not. Unlisted fragments use `surface`. */
  materials: Readonly<Record<string, Material>>;
  as?: 'div' | 'ul' | 'ol';
  className?: string;
  label?: string;
}) {
  const layouts = resolveComposition(composition);
  const ids = fragmentIds(composition);
  for (const cell of cells) {
    if (!ids.includes(cell.fragment)) throw new Error(`Composition "${composition.name}" has no fragment "${cell.fragment}".`);
  }
  const bound = new Set(cells.map((cell) => cell.fragment));
  const materialOf = (fragment: string) => materials[fragment] ?? 'surface';
  const surfaced = new Set(ids.filter((fragment) => materialOf(fragment) !== 'ground'));

  const groupStyle = Object.fromEntries(BREAKPOINTS.flatMap((breakpoint) => {
    const { layout } = layouts[breakpoint];
    const { x } = layout.irregularity ?? { x: 0.12 };
    // How far a seam can push into a cell sideways, as a share of the group's width.
    const reach = Math.round(((x * 2.4) / layout.columns) * 10000) / 100;
    return [
      [`--columns-${breakpoint}`, String(layout.columns)],
      [`--rows-${breakpoint}`, String(layout.rows)],
      [`--seam-reach-${breakpoint}`, `${reach}cqi`],
    ];
  })) as CSSProperties;

  const placement = (fragment: string) => Object.fromEntries(BREAKPOINTS.flatMap((breakpoint) => {
    const { layout, geometry } = layouts[breakpoint];
    const [column, row, columns, rows] = layout.areas[fragment]!;
    return [
      [`--area-${breakpoint}`, `${row + 1} / ${column + 1} / span ${rows} / span ${columns}`],
      [`--clip-${breakpoint}`, clipPath(geometry, fragment)],
    ];
  })) as CSSProperties;

  const surface = (fragment: string, index: number) => (
    <span
      aria-hidden="true"
      className="fg-surface"
      data-material={materialOf(fragment)}
      style={{ ...pick(placement(fragment), 'clip'), '--facet': `${138 + ((index * 29) % 54)}deg` } as CSSProperties}
    />
  );

  const List = as;
  const Item = as === 'div' ? 'div' : 'li';
  return (
    <div className={cx('fg', className)} data-fragment-group={composition.name} data-lit style={groupStyle}>
      <List className="fg-cells" aria-label={label}>
        {cells.map((cell) => {
          const index = ids.indexOf(cell.fragment);
          const contentClass = cx('fg-content', cell.className);
          return (
            <Item key={cell.key ?? cell.fragment} className="fg-cell" data-material={materialOf(cell.fragment)} style={pick(placement(cell.fragment), 'area')}>
              {surface(cell.fragment, index)}
              {cell.href ? (
                <Link href={cell.href} className={contentClass}>{cell.content}</Link>
              ) : (
                <div className={contentClass}>{cell.content}</div>
              )}
            </Item>
          );
        })}
      </List>
      <div className="fg-art" aria-hidden="true">
        {ids.map((fragment, index) => (bound.has(fragment) ? null : <Fragment key={fragment}>{surface(fragment, index)}</Fragment>))}
        {BREAKPOINTS.map((breakpoint: Breakpoint) => (
          <SeamNetwork key={breakpoint} id={id} breakpoint={breakpoint} resolved={layouts[breakpoint]} surfaced={surfaced} />
        ))}
      </div>
    </div>
  );
}

function pick(style: CSSProperties, prefix: 'area' | 'clip'): CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([key]) => key.startsWith(`--${prefix}-`))) as CSSProperties;
}
