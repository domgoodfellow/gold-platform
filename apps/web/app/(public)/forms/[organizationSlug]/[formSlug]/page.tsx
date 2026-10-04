import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BrandStyle } from '@/features/branding/brand-style';
import { PublicForm } from '@/features/forms/public-form';
import { PublicHeader } from '@/features/public-profile/public-header';
import { getPublicDb } from '@/lib/db/public';
import { logoUrl } from '@/lib/domain/branding/brand';
import { publishedForm } from '@/lib/domain/forms/public-forms';
import { submitFormAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * A business's published form. The address names the business and the form by their public slugs;
 * `published_form` answers for a published form only, so a draft, an archived form and an address
 * that was never one are the same 404. The page renders the same definition the Studio preview does,
 * through the same renderer.
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

  const logo = form.brand.logoPath ? logoUrl(getPublicDb(), form.brand.logoPath) : null;

  async function submit(input: { revisionId: string; answers: Record<string, unknown>; website?: string }) {
    'use server';
    return submitFormAction({
      organizationSlug: decodeURIComponent(organizationSlug),
      formSlug: decodeURIComponent(formSlug),
      ...input,
    });
  }

  return (
    <main data-brand className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <BrandStyle brand={{ accent: form.brand.accent, headingFont: form.brand.headingFont, bodyFont: form.brand.bodyFont, logoPath: form.brand.logoPath }} />
      <PublicHeader profile={form.profile} logoUrl={logo} />
      <div className="mt-8">
        <PublicForm definition={form.definition} revisionId={form.revisionId} submit={submit} />
      </div>
    </main>
  );
}
