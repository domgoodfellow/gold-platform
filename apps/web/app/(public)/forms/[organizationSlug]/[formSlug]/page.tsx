import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HostedFormPage } from '@/features/forms/hosted-form-page';
import { getPublicDb } from '@/lib/db/public';
import { logoUrl } from '@/lib/domain/branding/brand';
import { publishedForm } from '@/lib/domain/forms/public-forms';

export const dynamic = 'force-dynamic';

/**
 * A business's published form at its readable address. The address names the business and the form
 * by their public slugs; `published_form` answers for a published form only, so a draft, an archived
 * form and an address that was never one are the same 404. Slugs can change (a business may rename
 * itself), so the link a business shares is the stable `/f/{key}` one; this is the readable form.
 */
async function load(organizationSlug: string, formSlug: string) {
  return publishedForm(getPublicDb(), decodeURIComponent(organizationSlug), decodeURIComponent(formSlug));
}

export async function generateMetadata({ params }: PageProps<'/forms/[organizationSlug]/[formSlug]'>): Promise<Metadata> {
  const { organizationSlug, formSlug } = await params;
  const form = await load(organizationSlug, formSlug);
  return { title: form ? `${form.definition.title} · ${form.profile.displayName}` : undefined };
}

export default async function PublicFormPage({ params }: PageProps<'/forms/[organizationSlug]/[formSlug]'>) {
  const { organizationSlug, formSlug } = await params;
  const form = await load(organizationSlug, formSlug);
  if (!form) notFound();
  return <HostedFormPage form={form} logoUrl={form.brand.logoPath ? logoUrl(getPublicDb(), form.brand.logoPath) : null} />;
}
