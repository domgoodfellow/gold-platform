import type { DocumentRenderer } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that names
 * one. Loaded on first use, so a page that never draws a document never loads the renderer.
 */
export async function documentRenderer(): Promise<DocumentRenderer> {
  const { reactPdfRenderer } = await import('./react-pdf');
  return reactPdfRenderer;
}
