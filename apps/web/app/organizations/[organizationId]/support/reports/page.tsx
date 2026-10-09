import { SupportPage } from "@/lib/application/support/page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/organizations/[organizationId]/support/reports">) {
  const { organizationId } = await params;
  return (
    <SupportPage
      organizationId={organizationId}
      view="reports"
      query={await searchParams}
    />
  );
}
