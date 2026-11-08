import type { Db } from "@/lib/db/types";
import { fromDatabaseError } from "@/lib/domain/errors";
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
    throw fromDatabaseError(threads.error, "communications.read_failed");
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
    throw fromDatabaseError(selected.error, "communications.read_failed");
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
    throw fromDatabaseError(entries.error, "communications.read_failed");
  return {
    threads: threads.data ?? [],
    selected: selected?.data ?? null,
    entries: (entries?.data ?? []).reverse(),
  };
}
export type WebsiteConversations = Awaited<
  ReturnType<typeof websiteConversations>
>;
