import { SupportPage } from "@/features/support/support-page";
import { requireOrganization } from "@/lib/route/organization";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/organizations/[organizationId]/support/cases">) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  return (
    <SupportPage
      organizationId={organizationId}
      view="cases"
      query={await searchParams}
    />
  );
}
