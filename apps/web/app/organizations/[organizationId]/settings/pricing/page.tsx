import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';
export default async function LegacyConfiguration({ params, searchParams }: PageProps<'/organizations/[organizationId]/settings/pricing'>) {
 const { organizationId } = await params;
 redirect(configurationRedirectHref(organizationId, 'finance/configuration/pricing', await searchParams));
}
