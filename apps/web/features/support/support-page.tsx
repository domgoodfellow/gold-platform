import { WorkspaceConfigure } from "@/features/settings/workspace-configure";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/route/organization";
import { readSupport } from "@/lib/domain/support/support";
import {
  SupportWorkspace,
  type SupportView,
} from "@/features/support/workspace";

export async function SupportPage({
  organizationId,
  view,
  query,
  caseId,
}: {
  organizationId: string;
  view: SupportView;
  query: Record<string, string | string[] | undefined>;
  caseId?: string;
}) {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes("support.read")) notFound();
  const filters = Object.fromEntries(
    Object.entries(query).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  if (caseId) filters.selected = caseId;
  if (view === "home" && !filters.status) filters.status = "active";
  const data = await readSupport(db, organizationId, view, filters);
  if (caseId && !data.selected) notFound();
  return (
    <SupportWorkspace
      organizationId={organizationId}
      timezone={organization.timezone}
      capabilities={organization.capabilities}
      view={view}
      data={data}
      configure={<WorkspaceConfigure organizationId={organizationId} workspace="support" />}
    />
  );
}
