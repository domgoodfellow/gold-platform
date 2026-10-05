import { notFound } from 'next/navigation';
import { BrandStyle } from '@/features/branding/brand-style';
import { EmbedResizer } from '@/features/forms/embed-resizer';
import { KeyedPublicForm } from '@/features/forms/keyed-public-form';
import { getPublicDb } from '@/lib/db/public';
import { publishedFormByKey } from '@/lib/domain/forms/public-forms';

export const dynamic = 'force-dynamic';

/**
 * A published form for another site to frame. It resolves exactly what the hosted page resolves —
 * the published revision named by a public key — and nothing else: no business header, no link into
 * the application, no editor state. A draft, an archived form and a made-up key are the same 404.
 * Appearance is the business's own brand; there is no theme of the embed's own.
 */
export default async function EmbeddedFormPage({ params }: PageProps<'/embed/forms/[publicKey]'>) {
  const { publicKey } = await params;
  const form = await publishedFormByKey(getPublicDb(), publicKey);
  if (!form) notFound();
  return (
    <main data-brand className="w-full p-1">
      <BrandStyle brand={form.brand} />
      <KeyedPublicForm definition={form.definition} revisionId={form.revisionId} publicKey={form.publicKey} source="embed" />
      <EmbedResizer publicKey={form.publicKey} />
    </main>
  );
}
