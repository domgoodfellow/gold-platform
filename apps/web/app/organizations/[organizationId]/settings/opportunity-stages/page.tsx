import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';
export default async function LegacyConfiguration({ params, searchParams }: PageProps<'/organizations/[organizationId]/settings/opportunity-stages'>) {
 const { organizationId } = await params;
 redirect(configurationRedirectHref(organizationId, 'sales/configuration/opportunity-stages', await searchParams));
}
