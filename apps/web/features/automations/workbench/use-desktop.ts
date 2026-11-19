'use client';

import { useEffect, useState } from 'react';

const DESKTOP = '(min-width: 1024px)';

/**
 * Whether the screen is wide enough for the workbench's side-by-side layout. False until the
 * browser has answered, so layout that must not flash is chosen with `lg:` classes instead and this
 * only decides behaviour: control sizes, where focus goes, whether the canvas loads.
 */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
}
