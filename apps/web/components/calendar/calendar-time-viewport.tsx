'use client';
import { useEffect, useRef, type ReactNode } from 'react';
export function CalendarTimeViewport({ children, period, focusColumn, columns }: { children: ReactNode; period: string; focusColumn: number; columns: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = 8 * 96;
    ref.current.scrollLeft = focusColumn * ref.current.scrollWidth / columns;
  }, [period, focusColumn, columns]);
  return <div ref={ref} className="h-full min-h-0 overflow-auto" data-calendar-time-scroll>{children}</div>;
}
