import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HostedFormPage } from '@/features/forms/hosted-form-page';
import { getPublicDb } from '@/lib/db/public';
import { logoUrl } from '@/lib/domain/branding/brand';
import { publishedFormByKey } from '@/lib/domain/forms/public-forms';

export const dynamic = 'force-dynamic';

/**
 * A published form at its stable address. The key never changes when the form or the business is
 * renamed, so this is the link to put in an email or on another site. It names a form anybody could
 * already open — never anything private — and answers for a published, unarchived one only.
 */
export async function generateMetadata({ params }: PageProps<'/f/[publicKey]'>): Promise<Metadata> {
  const { publicKey } = await params;
  const form = await publishedFormByKey(getPublicDb(), publicKey);
  return { title: form ? `${form.definition.title} · ${form.profile.displayName}` : undefined };
}

export default async function FormByKeyPage({ params }: PageProps<'/f/[publicKey]'>) {
  const { publicKey } = await params;
  const form = await publishedFormByKey(getPublicDb(), publicKey);
  if (!form) notFound();
  return <HostedFormPage form={form} logoUrl={form.brand.logoPath ? logoUrl(getPublicDb(), form.brand.logoPath) : null} />;
}
