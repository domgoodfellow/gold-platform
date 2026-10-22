import Link from "next/link";
import { requireOrganization } from "@/lib/route/organization";
import { readSupport, type RecordKind } from "@/lib/domain/support/support";
import { NewCase } from "./editors";
import { Badge } from "./ui";
import { OperationalPanel, PanelState } from "@/components/operational/primitives";

export async function RelatedSupport({
  organizationId,
  kind,
  recordId,
  customerId,
  customerName,
}: {
  organizationId: string;
  kind: RecordKind;
  recordId: string;
  customerId?: string | null;
  customerName?: string;
}) {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes("support.read")) return null;
  const filters: Record<string, string> =
    kind === "customer" ? { customer: recordId } : { related: recordId };
  const data = await readSupport(db, organizationId, "cases", filters);
  const base = `/organizations/${organizationId}/support/cases`;
  const defaults = {
    [kind]: recordId,
    ...(customerId ? { customer: customerId, customerName } : {}),
    ...(kind === "customer" ? { customerName } : {}),
  };
  return (
    <OperationalPanel body="edge-to-edge"
      title="Support Cases"
      href={`${base}?${new URLSearchParams(filters)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
        <span className="text-xs text-muted">{data.total} linked Cases</span>
        {organization.capabilities.includes("support.case.create") && (
          <NewCase
            organizationId={organizationId}
            data={data}
            defaults={defaults}
            mayAssign={organization.capabilities.includes(
              "support.case.assign",
            )}
            label="Create Support Case"
          />
        )}
      </div>
      <div className="divide-y divide-border">
        {data.cases.slice(0, 5).map((c) => (
          <Link
            key={c.id}
            href={`${base}/${c.id}`}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
          >
            <span className="font-medium">
              {c.case_number} · {c.title}
            </span>
            <Badge value={c.status} />
          </Link>
        ))}
        {!data.cases.length && <PanelState>No linked Support Cases.</PanelState>}
      </div>
    </OperationalPanel>
  );
}
