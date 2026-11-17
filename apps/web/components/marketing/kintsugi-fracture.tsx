import { useId } from 'react';

export type FractureVariant = 'hero' | 'bridge' | 'products' | 'automation' | 'connected' | 'process' | 'trust' | 'cta' | 'footer';

const MATERIAL = '/marketing-repaired-panels.webp';
// The material rendering was made from the six authored interlocking SVG faces.
// This generous hull trims isolated alpha artefacts outside that original assembly.
const HULL = 'M365 57 425 42 488 20 523 25 558 112 623 102 659 128 675 156 711 257 716 290 687 321 705 417 677 469 604 550 586 576 552 576 417 614 386 624 361 605 284 589 253 591 222 568 133 530 96 518 95 500 61 401 54 373 73 347 91 310 85 278 97 239 110 151 112 107 140 70 225 30 304 72Z';
// Select only the central three joins. The colour mask below confines the light
// to actual gold pixels, including the irregular solder edge and junction pools.
const REFLECTION_AREA = 'M248 220 452 255 478 206 510 153 555 116 585 107 542 164 503 202 482 300 456 352 444 367 462 410 494 444 465 456 413 385 415 354 444 306 446 285 250 254Z';

/** Fixed material and geometry; only a gold-masked specular reflection moves. */
export function KintsugiFracture({ variant }: { variant: FractureVariant }) {
  const id = `kintsugi-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (!['hero', 'cta', 'footer'].includes(variant)) return null;
  return (
    <svg className="kintsugi-fracture" data-fracture={variant} viewBox="0 0 760 660" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-gold`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          {/* White output with alpha derived from gold's warm channels. Cool
              surfaces and transparency contribute no reflection. Static filter. */}
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2 2 -4 0 -.65" />
        </filter>
        <mask id={`${id}-metal`} maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="660" style={{ maskType: 'alpha' }}>
          <image href={MATERIAL} width="760" height="660" preserveAspectRatio="none" filter={`url(#${id}-gold)`} />
        </mask>
        <mask id={`${id}-hull`} maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="660">
          <path d={HULL} fill="white" stroke="white" strokeWidth="32" strokeLinejoin="round" />
        </mask>
        <clipPath id={`${id}-selected`}><path d={REFLECTION_AREA} /></clipPath>
        <linearGradient id={`${id}-reflection`}>
          <stop stopColor="#fff7dc" stopOpacity="0" /><stop offset=".36" stopColor="#fff1bd" stopOpacity=".12" />
          <stop offset=".48" stopColor="#fff7dc" stopOpacity=".8" /><stop offset=".5" stopColor="#fffdf3" />
          <stop offset=".53" stopColor="#fff7dc" stopOpacity=".85" /><stop offset=".65" stopColor="#ffe6a0" stopOpacity=".1" /><stop offset="1" stopColor="#fff7dc" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g mask={`url(#${id}-hull)`}>
        <image className="kintsugi-material" href={MATERIAL} width="760" height="660" preserveAspectRatio="none" />
        <g mask={`url(#${id}-metal)`}>
          {/* Keep the gold's original colour when the surrounding faces darken. */}
          <image href={MATERIAL} width="760" height="660" preserveAspectRatio="none" />
          <g clipPath={`url(#${id}-selected)`}>
            <rect className="kintsugi-reflection" x="-210" y="0" width="210" height="660" fill={`url(#${id}-reflection)`} />
          </g>
        </g>
      </g>
    </svg>
  );
}
