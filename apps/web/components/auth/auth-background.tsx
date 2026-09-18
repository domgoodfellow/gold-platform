'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const LightPillar = dynamic(() => import('./light-pillar'), { ssr: false });

interface PillarTheme {
  topColor: string;
  bottomColor: string;
}

/** Reads GOLD's own colour roles rather than naming a colour here — `globals.css` §3. */
function resolvePillarTheme(): PillarTheme {
  if (typeof window === 'undefined') return { topColor: '#171717', bottomColor: '#ffffff' };

  const computedStyle = window.getComputedStyle(document.documentElement);
  return {
    topColor: computedStyle.getPropertyValue('--accent').trim() || '#171717',
    bottomColor: computedStyle.getPropertyValue('--background').trim() || '#ffffff',
  };
}

/**
 * The ambient light behind the four credential screens — a visitor arriving here has left the
 * marketing page and met nothing but a bare card since; this gives the page some of its own
 * presence back. `SiteShell`'s header and footer still frame it, so this sits only behind
 * `AuthLayout`'s centred content, never the whole viewport.
 */
export function AuthBackground() {
  const [theme, setTheme] = useState<PillarTheme>(resolvePillarTheme);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener('change', onMotionChange);

    const observer = new MutationObserver(() => setTheme(resolvePillarTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

    return () => {
      media.removeEventListener('change', onMotionChange);
      observer.disconnect();
    };
  }, []);

  if (reducedMotion) return null;

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-x-[-10%] inset-y-[-8%] opacity-[0.14] dark:opacity-40"
        style={{
          maskImage: 'radial-gradient(closest-side, black, transparent)',
          WebkitMaskImage: 'radial-gradient(closest-side, black, transparent)',
        }}
      >
        <LightPillar
          topColor={theme.topColor}
          bottomColor={theme.bottomColor}
          intensity={0.4}
          rotationSpeed={0.22}
          glowAmount={0.0016}
          pillarWidth={3.4}
          pillarHeight={0.46}
          noiseIntensity={0.2}
          pillarRotation={18}
        />
      </div>
    </div>
  );
}
