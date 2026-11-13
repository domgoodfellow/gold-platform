'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { useVisualAppearance } from '@gold/ui/components/visual-scope';
import type { BackgroundTreatment } from '@gold/ui/design-system';
import { cx } from '../class-names';

/**
 * The one decorative-background renderer. The application shell mounts it through
 * ApplicationCanvasBackground; bounded brand previews may mount it in a relative isolate.
 *
 * It is purely decorative: `aria-hidden`, `pointer-events: none`, behind content (`-z-10` inside an
 * isolated region). Opaque content and overlay surfaces retain their own roles. Colours come only from the
 * brand and neutral tokens (`--accent`, `--brand-secondary`, `--brand-highlight`), so they follow the
 * organization palette and the theme. The choice is the person's (Appearance); `treatment`
 * overrides it only in previews.
 */
export function DecorativeBackground({ treatment, clear = 'end', className }: {
  treatment?: BackgroundTreatment;
  /** The side where the region's own content sits; the 3D lines fade out there. */
  clear?: 'start' | 'end';
  className?: string;
}) {
  const appearance = useVisualAppearance();
  const chosen = treatment ?? appearance.background ?? 'none';
  if (chosen === 'none') return null;
  if (chosen === 'ambient3d') return <Ambient3d className={className} clear={clear} reducedMotion={appearance.motion === 'reduced'} />;
  return <div aria-hidden data-decorative-background={chosen} className={cx('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)} style={chosen === 'grid' ? GRID : GRADIENT} />;
}

/** A viewport-sized layer in the existing main scroller. Its negative margin leaves layout and
 * page height unchanged; sticky positioning keeps long pages covered beneath the sticky header.
 * The parent is isolated, but never clipped or transformed (fixed overlays keep their viewport).
 * Previews supply their frame height through --application-canvas-height. */
export function ApplicationCanvasBackground() {
  const appearance = useVisualAppearance();
  if (!appearance.background || appearance.background === 'none') return null;
  return <div aria-hidden data-slot="application-canvas-background"><DecorativeBackground /></div>;
}

const GRADIENT: CSSProperties = {
  backgroundImage: [
    'radial-gradient(60% 90% at 12% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 70%)',
    'radial-gradient(50% 80% at 88% 10%, color-mix(in srgb, var(--brand-secondary, var(--accent)) 18%, transparent), transparent 70%)',
    'radial-gradient(40% 70% at 55% 110%, color-mix(in srgb, var(--brand-highlight, var(--accent)) 12%, transparent), transparent 70%)',
  ].join(','),
};

const GRID: CSSProperties = {
  backgroundImage: [
    'linear-gradient(color-mix(in srgb, var(--accent-indicator, var(--foreground)) 7%, transparent) 1px, transparent 1px)',
    'linear-gradient(90deg, color-mix(in srgb, var(--accent-indicator, var(--foreground)) 7%, transparent) 1px, transparent 1px)',
  ].join(','),
  backgroundSize: '24px 24px',
};

/** Resolve a token (which may be var(), light-dark() or lab()) to a hex string for WebGL. */
function resolveColour(element: HTMLElement, token: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token}, ${fallback})`;
  probe.style.display = 'none';
  element.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return fallback;
  context.fillStyle = computed; context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Optional Three.js scene: a slowly undulating wireframe surface in the brand colours. Loaded only on
 * the client and only when chosen. It falls back to the static gradient when WebGL is unavailable,
 * on small or low-powered devices, or on any initialisation error, so it can never stop a page from
 * loading. With reduced motion (system or saved) it draws a single still frame. It pauses while the
 * page is hidden, caps the pixel ratio, and disposes every GPU resource on unmount.
 */
function Ambient3d({ className, clear, reducedMotion }: { className?: string; clear: 'start' | 'end'; reducedMotion: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup = () => {};
    // The host already paints the static gradient; falling back only marks it, so there is nothing to re-render.
    const fallBack = () => { element.dataset.decorativeBackground = 'ambient3d-fallback'; };
    const matches = (query: string) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    let usable = false;
    try {
      const constrained = matches('(max-width: 40rem)') || (navigator.hardwareConcurrency ?? 8) <= 2;
      const probe = document.createElement('canvas');
      usable = !constrained && Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
    } catch { usable = false; }
    if (!usable) { fallBack(); return; }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let still = reducedMotion || motionQuery.matches;

    import('three').then(THREE => {
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.domElement.setAttribute('aria-hidden', 'true');
      // Low-opacity lines soften toward the content side; opaque surfaces stay above the decoration.
      const fade = `linear-gradient(${clear === 'end' ? 'to right' : 'to left'},#000 0%,#000 20%,transparent 60%),linear-gradient(to bottom,transparent 0%,#000 35%,#000 65%,transparent 100%)`;
      renderer.domElement.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mask-image:${fade};-webkit-mask-image:${fade};mask-composite:intersect;-webkit-mask-composite:source-in;`;
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 2.2, 5.5); camera.lookAt(0, 0, 0);
      const geometry = new THREE.PlaneGeometry(12, 6, 48, 24);
      geometry.rotateX(-Math.PI / 2.4);
      const base = geometry.attributes.position.array.slice() as Float32Array;
      const primary = new THREE.MeshBasicMaterial({ color: resolveColour(element, '--accent', '#666666'), wireframe: true, transparent: true, opacity: 0.16 });
      const secondary = new THREE.MeshBasicMaterial({ color: resolveColour(element, '--brand-secondary', '#999999'), wireframe: true, transparent: true, opacity: 0.09 });
      const wire = new THREE.Mesh(geometry, primary);
      const echo = new THREE.Mesh(geometry, secondary);
      echo.position.y = -0.35;
      scene.add(wire, echo);

      const resize = () => {
        const { width, height } = element.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        // Decorative regions are short and wide: hold the horizontal view at ~60° so the surface spans the band evenly.
        camera.aspect = width / height;
        camera.fov = Math.min(60, Math.max(8, (2 * Math.atan(Math.tan(Math.PI / 6) / camera.aspect) * 180) / Math.PI));
        camera.updateProjectionMatrix();
      };
      let frame = 0; let running = false; const started = performance.now();
      const draw = (time: number) => {
        const t = (time - started) / 4000;
        const positions = geometry.attributes.position.array as Float32Array;
        for (let index = 0; index < positions.length; index += 3) {
          positions[index + 1] = base[index + 1] + Math.sin(base[index] * 0.6 + t) * 0.18 + Math.cos(base[index + 2] * 0.8 + t * 0.7) * 0.12;
        }
        geometry.attributes.position.needsUpdate = true;
        renderer.render(scene, camera);
      };
      const loop = (time: number) => { if (!running) return; draw(time); frame = requestAnimationFrame(loop); };
      const start = () => { if (still || running || document.hidden) return; running = true; frame = requestAnimationFrame(loop); };
      const stop = () => { running = false; cancelAnimationFrame(frame); };
      const visibility = () => (document.hidden ? stop() : start());
      const motionChanged = () => { still = reducedMotion || motionQuery.matches; if (still) { stop(); draw(started); } else start(); };
      motionQuery.addEventListener('change', motionChanged);
      document.addEventListener('visibilitychange', visibility);
      const observer = new ResizeObserver(() => { resize(); draw(still ? started : performance.now()); });
      observer.observe(element); resize();
      draw(performance.now());
      start();

      cleanup = () => {
        stop();
        document.removeEventListener('visibilitychange', visibility);
        motionQuery.removeEventListener('change', motionChanged);
        observer.disconnect();
        geometry.dispose(); primary.dispose(); secondary.dispose();
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
    }).catch(() => { if (!disposed) fallBack(); });

    return () => { disposed = true; cleanup(); };
  }, [reducedMotion, clear]);

  return <div ref={host} aria-hidden data-decorative-background="ambient3d" className={cx('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)} style={GRADIENT} />;
}
