import { SupportPage } from "@/lib/application/support/page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/organizations/[organizationId]/support/cases/[caseId]">) {
  const { organizationId, caseId } = await params;
  return (
    <SupportPage
      organizationId={organizationId}
      caseId={caseId}
      view="detail"
      query={await searchParams}
    />
  );
}
