'use client';

import { useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@gold/ui/components/dialog';
import { Button } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';
import { PreviewFrame } from './preview-frame';

/** The reference viewports every visual preview offers, in CSS pixels. */
export const PREVIEW_VIEWPORTS = {
  desktop: { label: 'Desktop', width: 1440 },
  tablet: { label: 'Tablet', width: 768 },
  mobile: { label: 'Mobile', width: 390 },
} as const;
export type PreviewViewport = keyof typeof PREVIEW_VIEWPORTS;

export function ViewportControl({ value, onChange, label = 'Preview width' }: { value: PreviewViewport; onChange: (value: PreviewViewport) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-md border border-border p-0.5">
      {(Object.keys(PREVIEW_VIEWPORTS) as PreviewViewport[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cx('rounded px-2 py-1 text-xs font-medium transition', FOCUS_RING, value === key ? 'bg-foreground text-background' : 'text-muted hover:text-foreground')}
        >
          {PREVIEW_VIEWPORTS[key].label}
        </button>
      ))}
    </div>
  );
}

export type PreviewPage = { key: string; label: string; content: ReactNode };

/**
 * The large preview for a public visual experience — a website, a page or a section template — as opposed
 * to the page drawer, which is for forms beside the page. It fills the screen; its controls (title,
 * pages, reference width, close) sit outside the rendered content; the content is an isolated
 * viewport at the chosen width, scaled to fit and centred, and the preview body scrolls the page
 * vertically. Escape closes it and focus returns to what opened it.
 *
 * Previewing is reading: the surface holds only which page and width are shown, never the thing
 * previewed, so opening and closing it creates and changes nothing, and the collection it was opened
 * from keeps its own state.
 */
export function PreviewSurface({ title, trigger, pages, actions, defaultViewport = 'desktop' }: {
  title: string;
  /** The control that opens the preview (rendered as the dialog trigger). */
  trigger: ReactNode;
  /** One entry per page; more than one shows a page list. */
  pages: PreviewPage[];
  /** Commands that act on the previewed thing (e.g. Use template), beside the controls. */
  actions?: ReactNode;
  defaultViewport?: PreviewViewport;
}) {
  const [open, setOpen] = useState(false);
  const [viewport, setViewport] = useState<PreviewViewport>(defaultViewport);
  const [pageKey, setPageKey] = useState(pages[0]?.key ?? '');
  const page = pages.find((entry) => entry.key === pageKey) ?? pages[0];
  const { width, label } = PREVIEW_VIEWPORTS[viewport];

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setPageKey(pages[0]?.key ?? ''); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        data-preview-surface
        className="inset-2 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:inset-4"
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">{title}</DialogTitle>
          <DialogDescription className="sr-only">{`Preview at ${label} width`}</DialogDescription>
          <ViewportControl value={viewport} onChange={setViewport} />
          {actions}
          <DialogClose asChild>
            <Button tone="text" size="small" aria-label="Close preview"><XIcon aria-hidden className="size-4" /></Button>
          </DialogClose>
        </header>
        {pages.length > 1 ? (
          <nav aria-label="Pages" className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-2">
            {pages.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-current={entry.key === page?.key ? 'page' : undefined}
                onClick={() => setPageKey(entry.key)}
                className={cx('shrink-0 rounded px-2.5 py-1 text-sm transition', FOCUS_RING, entry.key === page?.key ? 'bg-secondary font-medium text-foreground' : 'text-muted hover:text-foreground')}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}
        <div data-preview-body className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-secondary p-3 sm:p-6">
          {page ? (
            <PreviewFrame key={`${page.key}-${viewport}`} title={`${title} · ${page.label} · ${label}`} width={width} publicDesign>
              {page.content}
            </PreviewFrame>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
