'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { previewInvoiceDocument } from '@/app/organizations/[organizationId]/finance/actions';

/**
 * The invoice this dialog is about to issue, as a draft PDF with the business's current look. The
 * draft opens in the browser's own document viewer (a new tab, full screen on a phone), which owns
 * zoom, print and download. It is stamped DRAFT, has no number and is never stored; changing the
 * dialog's details discards it.
 */
export function DraftDocumentPreview({ fields }: { fields: Record<string, string> }) {
  const signature = JSON.stringify(fields);
  const [draft, setDraft] = useState<{ signature: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const url = draft?.signature === signature ? draft.url : null;
  const current = useRef<string | null>(null);

  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);

  const prepare = () => start(async () => {
    setError(null);
    const result = await previewInvoiceDocument(fields);
    if ('error' in result) { setError(result.error); return; }
    const bytes = Uint8Array.from(atob(result.pdf), character => character.charCodeAt(0));
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setDraft({ signature, url: current.current });
  });

  return <div className="flex flex-col items-start gap-2 text-sm">
    {url ? <div className="flex flex-wrap items-center gap-3">
      <a className="font-medium underline underline-offset-4" href={url} target="_blank" rel="noopener">Open draft preview<span className="sr-only"> (PDF, opens in a new tab)</span></a>
      <a className="underline underline-offset-4" href={url} download="draft-invoice.pdf">Download draft</a>
    </div>
      : <Button type="button" tone="secondary" size="small" disabled={pending} onClick={prepare}><Eye aria-hidden className="size-4" />{pending ? 'Preparing preview…' : 'Preview document'}</Button>}
    <p className="text-xs text-muted">The preview is a draft with today’s branding. The issued invoice gets its number and is kept as issued.</p>
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </div>;
}
