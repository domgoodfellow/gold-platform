import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function LegacyNumber({ params, searchParams }: PageProps<'/organizations/[organizationId]/comms/numbers/[phoneNumberId]'>) {
  const { organizationId, phoneNumberId } = await params;
  redirect(configurationRedirectHref(organizationId, `comms/configuration/numbers/${phoneNumberId}`, await searchParams));
}
