'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/components/class-names';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
/** The frame's border width, in CSS pixels. */
const EDGE = 1;

/**
 * An isolated viewport for a visual experience: its content is rendered into a same-origin iframe
 * of exactly `width` CSS pixels, so the experience's own breakpoints and container queries follow
 * that reference width rather than the workspace around it. The frame is scaled to the space it is
 * given and centred in it; the document inside never scrolls.
 *
 * - `fit="content"` (default) shows the whole document: the frame is as tall as its content, and the
 *   page around it scrolls naturally.
 * - `fit="viewport"` shows one reference screen, `viewportHeight` tall, scaled to fill the available
 *   width — a thumbnail of what a visitor sees first, not a cropped page.
 *
 * Unless `interactive`, the content is a picture: inert, out of the tab order and never a pointer
 * target. Stylesheets are copied from the host document when the frame loads. `publicDesign` marks
 * a public experience (a website), so the operator's Appearance never reaches it.
 *
 * The frame owns its own edge (`data-slot="preview-frame"`): one border and the Appearance radius,
 * hugging the scaled viewport, so a narrow reference width is framed at its own width rather than
 * the space around it. The edge is the operator's chrome and follows the Appearance presets; what
 * is drawn inside it is the previewed experience's own. Callers never style the frame.
 */
export function PreviewFrame({ title, children, width = 1120, fit = 'content', viewportHeight, interactive = false, publicDesign = false, className }: {
  title: string;
  children: ReactNode;
  /** The reference viewport width, in CSS pixels. */
  width?: number;
  fit?: 'content' | 'viewport';
  /** With `fit="viewport"`: the reference screen height (defaults to a 16:10 screen). */
  viewportHeight?: number;
  /** The previewed content can be operated (an editor canvas, the navigation preview). */
  interactive?: boolean;
  /** The content is a public experience, drawn with the public design roles. */
  publicDesign?: boolean;
  /** Placement of the frame in its container (spacing), never its edge. */
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [contentHeight, setContentHeight] = useState(640);
  const screen = viewportHeight ?? Math.round((width * 10) / 16);

  // Called when the frame's document is ready: on its load event, or at mount when a
  // server-rendered frame finished loading before React attached that handler.
  const attach = () => {
    const doc = frame.current?.contentDocument;
    const root = doc?.getElementById('preview');
    if (!doc || !root || root.dataset.attached) return;
    root.dataset.attached = 'true';
    doc.documentElement.className = document.documentElement.className;
    for (const attribute of ['data-theme', 'data-scheme', 'style']) {
      const value = document.documentElement.getAttribute(attribute);
      if (value !== null) doc.documentElement.setAttribute(attribute, value);
    }
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => doc.head.appendChild(style.cloneNode(true)));
    // The document inside never scrolls: its frame is as tall as it (content) or one screen (viewport).
    doc.documentElement.style.overflow = 'hidden';
    doc.body.style.margin = '0';
    if (!interactive) root.setAttribute('inert', '');
    setTarget(root);
  };

  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === 'complete') attach();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for a frame that loaded before hydration
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!host.current) return;
    const measure = (value: number) => setAvailable(Math.max(0, value));
    measure(host.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry!.contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target || fit !== 'content') return;
    const measure = () => setContentHeight(Math.max(1, target.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [target, fit]);

  // A thumbnail fills the width it is given; a full preview is never drawn larger than life. The
  // edge's two border pixels come out of the space the viewport is scaled into.
  const room = available === null ? null : Math.max(0, available - EDGE * 2);
  const scale = room === null ? 1 : fit === 'viewport' ? room / width : Math.min(1, room / width);
  const frameHeight = fit === 'viewport' ? screen : contentHeight;

  return (
    <div ref={host} className={cx('flex w-full min-w-0 justify-center', className)}>
      <div
        data-slot="preview-frame"
        className="relative box-content shrink-0 overflow-hidden rounded-lg border border-border bg-background"
        style={{ width: room === null ? '100%' : width * scale, height: frameHeight * scale }}
      >
      <iframe
        ref={frame}
        title={title}
        srcDoc='<!doctype html><html><head></head><body><div id="preview"></div></body></html>'
        tabIndex={interactive ? undefined : -1}
        aria-hidden={interactive ? undefined : true}
        className={cx('absolute left-0 top-0 block origin-top-left border-0', !interactive && 'pointer-events-none')}
        style={{ width, height: frameHeight, transform: `scale(${scale})`, visibility: available === null ? 'hidden' : undefined }}
        onLoad={attach}
      />
      </div>
      {target ? createPortal(<div data-public-design={publicDesign || undefined} className="bg-background text-foreground">{children}</div>, target) : null}
    </div>
  );
}
