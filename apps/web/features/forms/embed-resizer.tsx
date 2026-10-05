'use client';

import { useEffect } from 'react';

/**
 * Tells the page hosting this embed how tall the form is. The only thing ever sent is a number,
 * which is why the target origin is `*`: the embedding page is not known in advance, and there is
 * nothing in the message to protect. The loader (`/embed.js`) accepts it only from its own frame.
 */
export function EmbedResizer({ publicKey }: { publicKey: string }) {
  useEffect(() => {
    if (window.parent === window) return;
    const report = () => window.parent.postMessage({ type: 'gildops:form:height', key: publicKey, height: document.documentElement.scrollHeight }, '*');
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, [publicKey]);
  return null;
}
