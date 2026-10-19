'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WorkspaceDestinationNav } from '../navigation/workspace-destination-nav';
import { cx } from '../class-names';

/** Optional destinations yield to actions when the actual page canvas cannot fit both. */
export function HeaderControls({ navigation, children }: { navigation: boolean; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const destinations = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);

  useEffect(() => {
    if (!navigation || !row.current || !destinations.current || !actions.current) return;
    const measure = () => {
      const available = row.current!.getBoundingClientRect().width;
      const navigationWidth = destinations.current!.getBoundingClientRect().width;
      const controls = actions.current!;
      const visible = Array.from(controls.children).filter(element => element.getBoundingClientRect().width > 0);
      const gap = parseFloat(getComputedStyle(controls).columnGap) || 0;
      const rowGap = parseFloat(getComputedStyle(row.current!).columnGap) || 0;
      const actionWidth = visible.reduce((width, element) => width + element.getBoundingClientRect().width, 0) + Math.max(0, visible.length - 1) * gap;
      setFits(navigationWidth > 0 && available >= 896 && navigationWidth + actionWidth + rowGap <= available);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row.current);
    observer.observe(destinations.current);
    observer.observe(actions.current);
    for (const control of actions.current.children) observer.observe(control);
    measure();
    return () => observer.disconnect();
  }, [navigation, children]);

  return <div ref={row} data-header-controls className={cx('relative flex min-w-0 items-center gap-4', navigation ? 'flex-1 basis-full' : 'ml-auto')}>
    {navigation ? <div ref={destinations} aria-hidden={!fits} inert={!fits}
      className={cx('w-max shrink-0', !fits && 'invisible absolute right-0 pointer-events-none')}>
      <WorkspaceDestinationNav />
    </div> : null}
    <div ref={actions} className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 [&>*]:max-w-full [&>*]:shrink-0">
      {children}
    </div>
  </div>;
}
