import { SupportPage } from "@/features/support/support-page";
import { requireOrganization } from "@/lib/route/organization";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/organizations/[organizationId]/support/cases/[caseId]">) {
  const { organizationId, caseId } = await params;
  await requireOrganization(organizationId);
  return (
    <SupportPage
      organizationId={organizationId}
      caseId={caseId}
      view="detail"
      query={await searchParams}
    />
  );
}
