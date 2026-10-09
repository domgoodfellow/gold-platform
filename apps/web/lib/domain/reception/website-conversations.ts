import type { Db } from "@/lib/db/types";
import { DomainError } from "@/lib/domain/errors";
export async function websiteConversations(
  db: Db,
  organizationId: string,
  threadId?: string,
) {
  const threads = await db
    .from("communication_threads")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("channel", "web")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (threads.error)
    throw new DomainError(threads.error.message, "communications.read_failed");
  const selected = threadId
    ? await db
        .from("communication_threads")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", threadId)
        .eq("channel", "web")
        .maybeSingle()
    : null;
  if (selected?.error)
    throw new DomainError(selected.error.message, "communications.read_failed");
  const entries = selected?.data
    ? await db
        .from("communication_entries")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("thread_id", selected.data.id)
        .order("created_at", { ascending: false })
        .limit(50)
    : null;
  if (entries?.error)
    throw new DomainError(entries.error.message, "communications.read_failed");
  return {
    threads: threads.data ?? [],
    selected: selected?.data ?? null,
    entries: (entries?.data ?? []).reverse(),
  };
}
export type WebsiteConversations = Awaited<
  ReturnType<typeof websiteConversations>
>;
