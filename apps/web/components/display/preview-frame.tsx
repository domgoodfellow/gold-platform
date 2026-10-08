'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** An isolated viewport keeps public responsive styles independent of workspace width. */
export function PreviewFrame({ title, children, src, width = 1120 }: { title: string; children?: ReactNode; src?: string; width?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(640);

  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / width)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    if (!target) return;
    const observer = new ResizeObserver(() => setHeight(target.scrollHeight));
    observer.observe(target);
    return () => observer.disconnect();
  }, [target]);

  return <div ref={host} className="min-w-0 overflow-hidden rounded-lg border border-border bg-background" style={{ height: height * scale }}>
    <iframe
      ref={frame}
      title={title}
      src={src}
      srcDoc={src ? undefined : '<!doctype html><html><head></head><body><div id="preview"></div></body></html>'}
      tabIndex={src ? -1 : undefined}
      className={src ? 'pointer-events-none block origin-top-left border-0' : 'block origin-top-left border-0'}
      style={{ width, height, transform: `scale(${scale})` }}
      onLoad={() => {
        const doc = frame.current?.contentDocument;
        if (!doc || src) return;
        doc.documentElement.className = document.documentElement.className;
        document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => doc.head.appendChild(style.cloneNode(true)));
        doc.body.style.margin = '0';
        setTarget(doc.getElementById('preview'));
      }}
    />
    {target ? createPortal(<div className="pointer-events-none bg-background p-6 text-foreground">{children}</div>, target) : null}
  </div>;
}
