import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';
export default async function LegacyPage({params, searchParams}:PageProps<'/organizations/[organizationId]/support/service-levels'>) {
 const {organizationId} = await params;
 redirect(configurationRedirectHref(organizationId, 'support/configuration/service-levels', await searchParams));
}
