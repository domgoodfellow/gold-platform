import { redirect } from 'next/navigation';

export default async function LegacyPricingPage({
  params,
}: PageProps<'/organizations/[organizationId]/pricing'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/finance/configuration/pricing`);
}
