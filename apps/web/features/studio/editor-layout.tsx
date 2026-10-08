import type { ReactNode } from 'react';

export function EditorLayout({ structure, inspector, children, structureLabel = 'Structure', canvasLabel = 'Canvas' }: { structure: ReactNode; inspector: ReactNode; children: ReactNode; structureLabel?: string; canvasLabel?: string }) {
  return <div className="grid min-w-0 gap-3 @min-[56rem]/editor:grid-cols-[14rem_minmax(0,1fr)_17rem]">
    <section aria-label={structureLabel} className="hidden min-w-0 overflow-hidden rounded-lg border border-border bg-surface @min-[56rem]/editor:block">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{structureLabel}</h2>
      <div className="max-h-[75vh] overflow-y-auto p-3">{structure}</div>
    </section>
    <section aria-label={canvasLabel} className="min-w-0 overflow-hidden rounded-lg border border-border bg-secondary">
      <h2 className="border-b border-border bg-surface px-4 py-3 text-sm font-semibold">{canvasLabel}</h2>
      <div className="max-h-[75vh] min-h-96 overflow-y-auto overflow-x-hidden p-3 sm:p-5">{children}</div>
    </section>
    <section aria-label="Inspector" className="hidden min-w-0 overflow-hidden rounded-lg border border-border bg-surface @min-[56rem]/editor:block">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Inspector</h2>
      <div className="max-h-[75vh] overflow-y-auto p-4">{inspector}</div>
    </section>
  </div>;
}
