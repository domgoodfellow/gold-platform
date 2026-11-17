import { pathData } from './geometry';
import type { Breakpoint, ResolvedLayout } from './composition';

/**
 * The permanent boundaries of one arrangement, drawn once for the whole group: every shared seam,
 * and the outer edges of fragments that have a visible surface. Stroke widths stay constant while
 * the drawing stretches with the group, so seams read the same at every size.
 *
 * Four layers, bottom to top: the groove a seam sits in, the metal, a reflective edge whose
 * strength follows the composition's light, and the narrow glints that travel along the seams
 * chosen to shimmer. Colours come from the material tokens; nothing here names a colour.
 */
export function SeamNetwork({ id, breakpoint, resolved, surfaced }: {
  id: string;
  breakpoint: Breakpoint;
  resolved: ResolvedLayout;
  /** Fragments whose outer edges are drawn. Open (`ground`) fragments have no edge. */
  surfaced: ReadonlySet<string>;
}) {
  const { geometry, shimmer } = resolved;
  const seams = geometry.seams.map(pathData).join(' ');
  const edges = Object.entries(geometry.edges)
    .filter(([fragment]) => surfaced.has(fragment))
    .flatMap(([, runs]) => runs.map(pathData))
    .join(' ');
  const gradient = `${id}-${breakpoint}-metal`;
  const viewBox = `0 0 ${geometry.columns} ${geometry.rows}`;
  return (
    <>
    <svg
      className="fg-seams"
      data-breakpoint={breakpoint}
      viewBox={viewBox}
      preserveAspectRatio="none"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.columns} y2={geometry.rows}>
          <stop offset="0" className="fg-metal-shadow" />
          <stop offset="0.3" className="fg-metal-body" />
          <stop offset="0.48" className="fg-metal-reflection" />
          <stop offset="0.62" className="fg-metal-body" />
          <stop offset="1" className="fg-metal-shadow" />
        </linearGradient>
      </defs>
      {edges ? <path className="fg-edge" d={edges} /> : null}
      {seams ? (
        <>
          <path className="fg-seam-groove" d={seams} />
          <path className="fg-seam-metal" d={seams} stroke={`url(#${gradient})`} />
          <path className="fg-seam-light" d={seams} />
        </>
      ) : null}
    </svg>
    {shimmer.length ? (
      // The selected seams, fully bright, seen only through a narrow moving window (the mask).
      <svg className="fg-seams fg-glints" data-breakpoint={breakpoint} viewBox={viewBox} preserveAspectRatio="none" focusable="false">
        <path className="fg-seam-glint" d={shimmer.map((index) => pathData(geometry.seams[index]!)).join(' ')} />
      </svg>
    ) : null}
    </>
  );
}
