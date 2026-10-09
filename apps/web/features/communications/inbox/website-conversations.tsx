"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/controls/button";
import { TextArea } from "@/components/controls/inputs";
import type { WebsiteConversations } from "@/lib/domain/reception/website-conversations";
import { handleWebsiteConversation } from "./website-actions";
export function WebsiteConversationView({
  organizationId,
  data,
  canReply,
  userId,
}: {
  organizationId: string;
  data: WebsiteConversations;
  canReply: boolean;
  userId: string;
}) {
  const router = useRouter(),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [pending, start] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(timer);
  }, [router]);
  function act(action: string) {
    if (!data.selected) return;
    start(async () => {
      const result = await handleWebsiteConversation(
        organizationId,
        data.selected!.id,
        action,
        text,
      );
      if (result.error) setError(result.error);
      else {
        setText("");
        router.refresh();
      }
    });
  }
  return (
    <div className="grid min-h-0 flex-1 overflow-auto md:grid-cols-[240px_minmax(0,1fr)]">
      <section
        aria-label="Website conversations"
        className="border-r border-border p-3"
      >
        <h2 className="mb-3 text-sm font-semibold">Website conversations</h2>
        {data.threads.map((t) => (
          <Link
            key={t.id}
            className="block rounded-md border-b border-border p-3 text-sm hover:bg-secondary"
            href={`/organizations/${organizationId}/comms/inbox/website?thread=${t.id}`}
          >
            <strong>{t.id.slice(0, 8)}</strong>
            <span className="mt-1 block text-xs text-muted">
              {t.state} · {new Date(t.updated_at).toLocaleString()}
            </span>
          </Link>
        ))}
        {!data.threads.length && (
          <p className="text-sm text-muted">No website conversations.</p>
        )}
      </section>
      <section className="min-w-0 space-y-4 p-4">
        {data.selected ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">
                  Website visitor · {data.selected.id.slice(0, 8)}
                </h2>
                <p className="text-xs text-muted">
                  {data.selected.state} · anonymous visitor · no Customer
                  created
                </p>
              </div>
              <div className="flex gap-2">
                {canReply && (
                  <>
                    <Button
                      disabled={
                        pending ||
                        Boolean(
                          data.selected.claimed_by &&
                          data.selected.claimed_by !== userId,
                        )
                      }
                      onClick={() => act("claim")}
                    >
                      Claim
                    </Button>
                    <Button
                      tone="secondary"
                      disabled={pending || data.selected.claimed_by !== userId}
                      onClick={() => act("resolve")}
                    >
                      Resolve
                    </Button>
                  </>
                )}
              </div>
            </header>
            <div className="space-y-3">
              {data.entries.map((e) => (
                <div
                  key={e.id}
                  className={`max-w-[90%] rounded-lg border border-border p-3 text-sm ${e.direction === "outbound" ? "ml-auto bg-secondary" : ""}`}
                >
                  <p className="mb-1 text-[10px] text-muted">
                    {e.direction === "inbound"
                      ? "Visitor"
                      : e.created_by
                        ? "Team member"
                        : "Agent"}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{e.body}</p>
                </div>
              ))}
            </div>
            {canReply &&
              data.selected.claimed_by === userId &&
              data.selected.state === "claimed" && (
                <div className="space-y-2 border-t border-border pt-3">
                  <TextArea
                    aria-label="Website reply"
                    value={text}
                    maxLength={4000}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <Button
                    disabled={pending || !text.trim()}
                    onClick={() => act("reply")}
                  >
                    Send website reply
                  </Button>
                  <p className="text-xs text-muted">
                    The visitor sees this reply in the website widget while it
                    is open.
                  </p>
                </div>
              )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            Select a website conversation to inspect or claim.
          </p>
        )}
      </section>
    </div>
  );
}
