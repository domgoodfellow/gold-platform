import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function LegacyConfiguration({ params, searchParams }: PageProps<'/organizations/[organizationId]/settings/email'>) {
  const { organizationId } = await params;
  redirect(configurationRedirectHref(organizationId, 'comms/configuration/email', await searchParams));
}
