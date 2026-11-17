// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LightingController } from '@/features/visual-composition/lighting-controller';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

let observed: (() => void) | null = null;
let reducedMotion = false;

/** Two lit compositions stacked down an 800px viewport; `top` is where the first one starts. */
function page(top: number) {
  document.body.innerHTML = '<div data-lit id="near"></div><div data-lit id="far"></div>';
  const near = document.getElementById('near')!;
  const far = document.getElementById('far')!;
  const place = (element: HTMLElement, start: () => number, height: number) => {
    element.getBoundingClientRect = () => ({ top: start(), bottom: start() + height, height } as DOMRect);
  };
  const position = { top };
  place(near, () => position.top, 400);
  place(far, () => position.top + 1600, 400);
  return { near, far, scrollTo: (next: number) => { position.top = next; window.dispatchEvent(new Event('scroll')); } };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') && reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16) as unknown as number;
  window.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
  window.IntersectionObserver = class {
    private targets: Element[] = [];
    constructor(private callback: IntersectionObserverCallback) { observed = () => this.callback(this.targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), this as never); }
    observe(target: Element) { this.targets.push(target); }
    disconnect() { this.targets = []; }
    unobserve() {}
    takeRecords() { return []; }
    root = null; rootMargin = ''; thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  reducedMotion = false;
  observed = null;
});

describe('one light follows the reader down the page', () => {
  it('lights the composition at the focal line fully, a distant one not at all, and marks where the line crosses it', () => {
    const { near, far } = page(200);
    render(<LightingController />);
    act(() => { observed!(); vi.advanceTimersByTime(20); });
    expect(Number(near.style.getPropertyValue('--light'))).toBe(1);
    // The focal line is 42% down an 800px viewport: 336px, which is 136px into a box starting at 200.
    expect(Number(near.style.getPropertyValue('--light-y'))).toBeCloseTo(136 / 400, 2);
    expect(Number(far.style.getPropertyValue('--light'))).toBe(0);
  });

  it('shimmers only once scrolling settles, and stops as soon as it resumes', () => {
    const { near, scrollTo } = page(200);
    render(<LightingController />);
    act(() => { observed!(); vi.advanceTimersByTime(100); });
    expect(near.hasAttribute('data-shimmer')).toBe(false);
    act(() => { vi.advanceTimersByTime(500); });
    expect(near.hasAttribute('data-shimmer')).toBe(true);
    act(() => { scrollTo(150); });
    expect(near.hasAttribute('data-shimmer')).toBe(false);
    act(() => { vi.advanceTimersByTime(600); });
    expect(near.hasAttribute('data-shimmer')).toBe(true);
  });

  it('dims a composition as it leaves the reader\'s focus', () => {
    const { near, scrollTo } = page(200);
    render(<LightingController />);
    act(() => { observed!(); vi.advanceTimersByTime(20); });
    act(() => { scrollTo(-300); vi.advanceTimersByTime(20); });
    const light = Number(near.style.getPropertyValue('--light'));
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(1);
  });

  it('leaves the static light in place under reduced motion', () => {
    reducedMotion = true;
    const { near } = page(200);
    render(<LightingController />);
    expect(observed).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(near.style.getPropertyValue('--light')).toBe('');
    expect(near.hasAttribute('data-shimmer')).toBe(false);
  });

  it('removes everything it wrote when the page goes away', () => {
    const { near } = page(200);
    const { unmount } = render(<LightingController />);
    act(() => { observed!(); vi.advanceTimersByTime(600); });
    unmount();
    expect(near.style.getPropertyValue('--light')).toBe('');
    expect(near.hasAttribute('data-shimmer')).toBe(false);
  });
});
