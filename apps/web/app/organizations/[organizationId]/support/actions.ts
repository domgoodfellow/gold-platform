"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/route/organization";
import type { Json } from "@/lib/db/database.types";
import {
  commandSupport,
  readSupport,
  type RecordOption,
} from "@/lib/domain/support/support";

export async function supportCommandAction(
  organizationId: string,
  command: string,
  input: Record<string, Json | undefined>,
) {
  const { db, organization } = await requireOrganization(organizationId);
  const authority =
    command.startsWith("queue.") || command.startsWith("policy.")
      ? "support.configure"
      : command === "case.create"
        ? "support.case.create"
        : command === "case.assign"
          ? "support.case.assign"
          : ["case.resolve", "case.close", "case.reopen"].includes(command)
            ? "support.case.resolve"
            : "support.case.update";
  if (
    !organization.capabilities.includes("support.read") ||
    !organization.capabilities.includes(authority)
  )
    return { id: null, error: "Support permission required." };
  try {
    const id = await commandSupport(db, organizationId, command, input);
    revalidatePath(`/organizations/${organizationId}`, "layout");
    return { id, error: null };
  } catch (error) {
    return {
      id: null,
      error:
        error instanceof Error ? error.message : "Could not save the change.",
    };
  }
}
export async function supportSearchAction(
  organizationId: string,
  kind: string,
  q: string,
) {
  const { db } = await requireOrganization(organizationId);
  return readSupport<RecordOption[]>(db, organizationId, "search", { kind, q });
}
