"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/route/organization";
import type { Database } from "@/lib/db/types";

type Json =
  Database["public"]["Tables"]["ai_assistants"]["Row"]["configuration"];
export async function deleteAgent(organizationId: string, id: string) {
  const { db } = await requireOrganization(organizationId);
  const { error } = await db.rpc("delete_ai_assistant", { p_organization_id: organizationId, p_id: id });
  revalidatePath(`/organizations/${organizationId}/ai`, "layout");
  return { error: error?.message };
}
export async function deleteDeployment(organizationId: string, id: string) {
  const { db } = await requireOrganization(organizationId);
  const { error } = await db.rpc("delete_ai_deployment", { p_organization_id: organizationId, p_id: id });
  revalidatePath(`/organizations/${organizationId}/ai`, "layout");
  return { error: error?.message };
}
export async function saveAgent(
  organizationId: string,
  input: {
    id: string | null;
    name: string;
    instructions: string;
    configuration: Json;
    draft: number | null;
  },
) {
  const { db } = await requireOrganization(organizationId);
  const result = await db.rpc("save_ai_assistant", {
    p_organization_id: organizationId,
    p_id: input.id!,
    p_name: input.name,
    p_instructions: input.instructions,
    p_configuration: input.configuration,
    p_expected_draft: input.draft!,
  });
  if (result.error) return { error: result.error.message };
  revalidatePath(`/organizations/${organizationId}/ai`, "layout");
  return { id: result.data };
}
export async function publishAgent(
  organizationId: string,
  id: string,
  draft: number,
  status: "active" | "disabled",
) {
  const { db } = await requireOrganization(organizationId);
  const result = await db.rpc("publish_ai_assistant", {
    p_organization_id: organizationId,
    p_id: id,
    p_status: status,
    p_expected_draft: draft,
  });
  if (result.error) return { error: result.error.message };
  revalidatePath(`/organizations/${organizationId}/ai`, "layout");
  return { id: result.data };
}
export async function setKnowledge(
  organizationId: string,
  agentId: string,
  siteId: string,
  enabled: boolean,
) {
  const { db } = await requireOrganization(organizationId);
  const { error } = await db.rpc("set_ai_knowledge", {
    p_organization_id: organizationId,
    p_assistant_id: agentId,
    p_site_id: siteId,
    p_enabled: enabled,
  });
  revalidatePath(`/organizations/${organizationId}/ai`, "layout");
  return { error: error?.message };
}
export async function saveDeployment(
  organizationId: string,
  input: {
    id: string | null;
    agentId: string;
    versionId: string;
    surface: string;
    siteId: string | null;
    enabled: boolean;
    name: string;
    greeting: string;
    handoff: string;
    configuration: Json;
  },
) {
  const { db } = await requireOrganization(organizationId);
  const result = await db.rpc("save_ai_deployment", {
    p_organization_id: organizationId,
    p_id: input.id!,
    p_assistant_id: input.agentId,
    p_version_id: input.versionId,
    p_surface: input.surface,
    p_site_id: input.siteId!,
    p_enabled: input.enabled,
    p_display_name: input.name,
    p_greeting: input.greeting,
    p_handoff: input.handoff,
    p_configuration: input.configuration,
  });
  if (result.error) return { error: result.error.message };
  revalidatePath(`/organizations/${organizationId}/ai`, "layout");
  return { id: result.data };
}
export async function testAgent(
  organizationId: string,
  agentId: string,
  versionId: string,
  question: string,
  criterion: string,
) {
  const { db, organization } = await requireOrganization(organizationId);
  if (
    !organization.capabilities.includes("organization.manage") ||
    !organization.capabilities.includes("assistant.ask")
  )
    return {
      error: "Agent testing requires organization management and Agent access.",
    };
  if (
    !question.trim() ||
    question.length > 2000 ||
    !criterion.trim() ||
    criterion.length > 1000
  )
    return {
      error:
        "Enter a question and expected criterion within the supported limits.",
    };
  const { data: session } = await db.auth.getSession();
  const api = process.env.ASSISTANT_API_URL;
  if (!api || !session.session)
    return { error: "The answering service is unavailable." };
  try {
    const response = await fetch(`${api.replace(/\/$/, "")}/ai/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.session.access_token}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        question,
        preview: { agentId, versionId },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const body = (await response.json()) as {
      error?: string;
      answer?: string;
      outcome?: string;
      detail?: string;
    };
    if (!response.ok) return { error: body.error ?? "Preview failed." };
    const { data, error } = await db
      .from("ai_assistant_evaluations")
      .insert({
        organization_id: organizationId,
        assistant_id: agentId,
        version_id: versionId,
        scenario: question,
        criterion,
        answer: (body.answer ?? "").slice(0, 4000),
        outcome: ["answered", "unanswered", "failed"].includes(
          body.outcome ?? "",
        )
          ? body.outcome!
          : "failed",
        detail: body.detail ?? null,
      })
      .select("*")
      .single();
    if (error) return { error: error.message };
    return { evaluation: data };
  } catch {
    return { error: "The preview service could not be reached." };
  }
}
export async function evaluateResult(
  organizationId: string,
  id: string,
  verdict: "passed" | "failed",
) {
  const { db } = await requireOrganization(organizationId);
  const { error } = await db
    .from("ai_assistant_evaluations")
    .update({ verdict })
    .eq("organization_id", organizationId)
    .eq("id", id);
  return { error: error?.message };
}
