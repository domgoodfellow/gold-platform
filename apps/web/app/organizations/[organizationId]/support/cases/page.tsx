import { SupportPage } from "@/lib/application/support/page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/organizations/[organizationId]/support/cases">) {
  const { organizationId } = await params;
  return (
    <SupportPage
      organizationId={organizationId}
      view="cases"
      query={await searchParams}
    />
  );
}
