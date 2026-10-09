"use server";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/route/organization";
export async function handleWebsiteConversation(
  organizationId: string,
  threadId: string,
  action: string,
  body = "",
) {
  const { db } = await requireOrganization(organizationId);
  const { error } = await db.rpc("handle_website_conversation", {
    p_organization_id: organizationId,
    p_thread_id: threadId,
    p_action: action,
    p_body: body,
  });
  revalidatePath(`/organizations/${organizationId}/comms/inbox/website`);
  return { error: error?.message };
}
