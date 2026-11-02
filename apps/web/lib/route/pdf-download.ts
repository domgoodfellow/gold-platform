import { NextResponse } from 'next/server';

/** A stored PDF as a download: never cached, never sniffed into something else, never rendered with the page's privileges. */
export function pdfDownload(file: { fileName: string; bytes: Uint8Array }): NextResponse {
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${safeName}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    },
  });
}
