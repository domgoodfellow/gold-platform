import { notFound } from 'next/navigation';
import { HostedFormPage } from '@/features/forms/hosted-form-page';
import { getPublicDb } from '@/lib/db/public';
import { logoUrl } from '@/lib/domain/branding/brand';
import { publishedHostnameForm } from '@/lib/domain/forms/public-forms';

export const dynamic = 'force-dynamic';

/**
 * A form at a business's own address — `https://{its hostname}/forms/{form slug}`. `proxy.ts`
 * rewrites that path here carrying the **hostname**, never an organization id, and the business is
 * whatever the one hostname resolver says it is. A hostname that resolves to nothing, or to a
 * portal, or a form that is not published, are the same 404.
 */
export default async function HostedSiteFormPage({ params }: PageProps<'/sites/[hostname]/forms/[formSlug]'>) {
  const { hostname, formSlug } = await params;
  const form = await publishedHostnameForm(getPublicDb(), decodeURIComponent(hostname), decodeURIComponent(formSlug));
  if (!form) notFound();
  return <HostedFormPage form={form} logoUrl={form.brand.logoPath ? logoUrl(getPublicDb(), form.brand.logoPath) : null} />;
}
