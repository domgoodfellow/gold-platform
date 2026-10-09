"use client";
import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/controls/button";
import { Textarea } from "@gold/ui/components/textarea";
type Entry = { id: string; direction: "inbound" | "outbound"; body: string };
function visitorKey(siteId: string) {
  const key = `gold.public-communication.${siteId}`,
    prior = localStorage.getItem(key);
  if (prior) return prior;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}
export function PublicCommunicationWidget({
  siteId,
  name,
  greeting,
}: {
  siteId: string;
  name: string;
  greeting: string;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [handoff, setHandoff] = useState(false),
    [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open)
      end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open, entries, busy]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    async function poll() {
      try {
        const params = new URLSearchParams({
            siteId,
            visitorKey: visitorKey(siteId),
          }),
          response = await fetch(`/api/public-communication?${params}`, {
            cache: "no-store",
          });
        if (!response.ok) return;
        const body = (await response.json()) as {
          entries?: Entry[];
          state?: string;
        };
        if (active && !busy) {
          setEntries(body.entries ?? []);
          setHandoff(
            ["handoff_requested", "claimed", "resolved", "closed"].includes(
              body.state ?? "",
            ),
          );
        }
      } catch {
        /* Sending reports connection errors; polling retains the last visible conversation. */
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, siteId, busy]);
  async function send(requestHandoff = false) {
    const message = requestHandoff
      ? "I would like to speak to a human."
      : text.trim();
    if (!message || busy || handoff) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/public-communication", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId,
          visitorKey: visitorKey(siteId),
          message,
          handoff: requestHandoff,
        }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        error?: string;
        handoff?: boolean;
      };
      if (!response.ok) {
        setError(payload.error ?? "Message could not be sent.");
        return;
      }
      setEntries((v) => [
        ...v,
        { id: crypto.randomUUID(), direction: "inbound", body: message },
        {
          id: crypto.randomUUID(),
          direction: "outbound",
          body: payload.answer ?? "No answer returned.",
        },
      ]);
      setText("");
      setHandoff(Boolean(payload.handoff));
    } catch {
      setError(
        "Connection failed. Your message may have been recorded. Check the conversation before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <Button
        className="size-12 rounded-full shadow-lg"
        aria-label={open ? "Close messages" : "Open messages"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X /> : <MessageCircle />}
      </Button>
      {open && (
        <section
          aria-label="Message the business"
          className="flex h-[min(38rem,calc(100dvh-5rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-border p-4">
            <MessageCircle size={19} />
            <div>
              <h2 className="font-medium">{name}</h2>
              <p className="text-xs text-muted">
                {handoff ? "Team follow-up requested" : "AI assistant"}
              </p>
            </div>
          </header>
          <div
            aria-live="polite"
            className="flex-1 space-y-3 overflow-y-auto p-4 text-sm"
          >
            <div className="max-w-[85%] rounded-lg bg-secondary p-3">
              {greeting}
            </div>
            {entries.map((e) => (
              <div
                key={e.id}
                className={
                  e.direction === "inbound"
                    ? "ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-accent p-3 text-on-accent"
                    : "max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-secondary p-3"
                }
              >
                {e.body}
              </div>
            ))}
            {busy && <p className="text-xs text-muted">Sending…</p>}
            <div ref={end} />
          </div>
          <footer className="border-t border-border p-3">
            {error && (
              <p role="alert" className="mb-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="Message to the business"
                className="min-h-11 max-h-28"
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  handoff
                    ? "Your request is with the team."
                    : "Write a message…"
                }
                disabled={busy || handoff}
              />
              <Button
                aria-label="Send message"
                disabled={busy || handoff || !text.trim()}
                onClick={() => void send()}
              >
                <Send size={16} />
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Do not share sensitive information.
              </p>
              <Button
                tone="text"
                size="tiny"
                disabled={busy || handoff}
                onClick={() => void send(true)}
              >
                Talk to a human
              </Button>
            </div>
          </footer>
        </section>
      )}
    </div>
  );
}
