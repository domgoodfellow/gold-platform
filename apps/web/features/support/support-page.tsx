import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/route/organization";
import { loadConfigurationContext } from "@/lib/route/workspace-configuration";
import { configTarget, configTargetOffered } from "@/lib/navigation";
import { readSupport, readSupportConfiguration } from "@/lib/domain/support/support";
import {
  SupportWorkspace,
  type SupportView,
} from "@/features/support/workspace";
import { SupportConfigurePanel } from "@/features/support/configuration";

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
  // Configure is offered from every page but a record's own, and only for the concerns this member may configure.
  const { gate } = await loadConfigurationContext(organizationId);
  const kinds = (["queue", "policy"] as const).filter((kind) =>
    configTargetOffered(configTarget(kind === "queue" ? "support-queues" : "support-service-levels"), gate),
  );
  const configure = kinds.length && view !== "detail" ? (
    <SupportConfigurePanel organizationId={organizationId} data={await readSupportConfiguration(db, organizationId)} kinds={kinds} />
  ) : undefined;
  return (
    <SupportWorkspace
      organizationId={organizationId}
      timezone={organization.timezone}
      capabilities={organization.capabilities}
      view={view}
      data={data}
      configure={configure}
    />
  );
}
