'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Where the reader's eye rests, as a share of the viewport height from the top. */
const FOCAL_LINE = 0.42;
/** How far from the focal line, in viewport heights, a composition's light fades to nothing. */
const REACH = 0.7;
/** How long scrolling must pause before the focused composition shimmers. */
const SETTLE_MS = 500;
/** How focused a composition must be to shimmer. */
const SHIMMER_FOCUS = 0.85;

/**
 * One light for the whole page. Each lit composition (`data-lit`) receives `--light`, how close
 * it is to the reader's focal line (0 to 1), and `--light-y`, where that line crosses it (0 at its
 * top, 1 at its bottom), so the brightest reflection sits where the reader is looking. When
 * scrolling settles, the most focused composition is marked `data-shimmer` and its selected seams
 * catch a moving glint; scrolling again stops it.
 *
 * Values are written as custom properties, never React state: nothing re-renders while the page
 * scrolls. One observer and one throttled scroll listener serve every composition. With reduced
 * motion the controller does nothing and the stylesheet's static light stays.
 */
export function LightingController() {
  const pathname = usePathname();
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let stop = () => {};
    const start = () => {
      stop();
      stop = reduced.matches ? () => {} : illuminate([...document.querySelectorAll<HTMLElement>('[data-lit]')]);
    };
    start();
    reduced.addEventListener('change', start);
    return () => {
      reduced.removeEventListener('change', start);
      stop();
    };
  }, [pathname]);
  return null;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function illuminate(targets: HTMLElement[]): () => void {
  if (!targets.length) return () => {};
  const visible = new Set<HTMLElement>();
  let frame = 0;
  let settle = 0;
  let shimmering: HTMLElement | null = null;

  const measure = (): { target: HTMLElement; focus: number } | null => {
    frame = 0;
    const height = window.innerHeight;
    const focal = height * FOCAL_LINE;
    let best: { target: HTMLElement; focus: number } | null = null;
    for (const target of visible) {
      const box = target.getBoundingClientRect();
      const distance = focal < box.top ? box.top - focal : focal > box.bottom ? focal - box.bottom : 0;
      const focus = 1 - smooth(Math.min(1, distance / (height * REACH)));
      target.style.setProperty('--light', focus.toFixed(3));
      target.style.setProperty('--light-y', clamp((focal - box.top) / Math.max(box.height, 1), -0.25, 1.25).toFixed(3));
      if (!best || focus > best.focus) best = { target, focus };
    }
    return best;
  };

  const settleShimmer = () => {
    const best = measure();
    if (best && best.focus >= SHIMMER_FOCUS) {
      shimmering = best.target;
      shimmering.setAttribute('data-shimmer', '');
    }
  };

  const onScroll = () => {
    if (!frame) frame = window.requestAnimationFrame(measure);
    shimmering?.removeAttribute('data-shimmer');
    shimmering = null;
    window.clearTimeout(settle);
    settle = window.setTimeout(settleShimmer, SETTLE_MS);
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      if (entry.isIntersecting) {
        visible.add(target);
      } else {
        visible.delete(target);
        target.style.setProperty('--light', '0');
      }
    }
    onScroll();
  }, { rootMargin: '20% 0px' });

  for (const target of targets) observer.observe(target);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  return () => {
    observer.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    window.cancelAnimationFrame(frame);
    window.clearTimeout(settle);
    for (const target of targets) {
      target.style.removeProperty('--light');
      target.style.removeProperty('--light-y');
      target.removeAttribute('data-shimmer');
    }
  };
}
