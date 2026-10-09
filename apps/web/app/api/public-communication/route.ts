import { NextResponse } from "next/server";
import { getPublicDb } from "@/lib/db/public";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: Request) {
  const url = new URL(request.url),
    siteId = url.searchParams.get("siteId") ?? "",
    visitorKey = url.searchParams.get("visitorKey") ?? "";
  if (!ID.test(siteId) || !ID.test(visitorKey))
    return NextResponse.json({ error: "Request rejected." }, { status: 400 });
  const db = getPublicDb();
  const rate = await db.rpc("consume_public_communication_rate_limit", {
    p_site_id: siteId,
    p_visitor_key: visitorKey,
  });
  if (rate.error || !rate.data?.[0]?.allowed)
    return NextResponse.json({ error: "Please wait." }, { status: 429 });
  const result = await db.rpc("public_communication_history", {
    p_site_id: siteId,
    p_visitor_key: visitorKey,
  });
  if (result.error)
    return NextResponse.json(
      { error: "Conversation unavailable." },
      { status: 503 },
    );
  return NextResponse.json(result.data ?? { entries: [], state: "open" }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const siteId = String(body.siteId ?? ""),
      visitorKey = String(body.visitorKey ?? ""),
      message = String(body.message ?? "").trim();
    if (
      !ID.test(siteId) ||
      !ID.test(visitorKey) ||
      !message ||
      message.length > 2000
    )
      return NextResponse.json({ error: "Message rejected." }, { status: 400 });
    const db = getPublicDb();
    const resolved = await db.rpc("public_assistant_deployment", {
      p_site_id: siteId,
    });
    if (resolved.error || !resolved.data)
      return NextResponse.json(
        { error: "Messaging is unavailable." },
        { status: 404 },
      );
    const deployment = resolved.data as {
      deploymentId: string;
      handoffMessage: string;
    };
    const saved = await db.rpc("record_public_communication", {
      p_site_id: siteId,
      p_visitor_key: visitorKey,
      p_body: message,
    });
    if (saved.error)
      return NextResponse.json(
        { error: saved.error.code === "54000" ? "Please wait before sending another message." : "Message could not be recorded." },
        { status: saved.error.code === "54000" ? 429 : 403, ...(saved.error.code === "54000" ? { headers: { "Retry-After": "60" } } : {}) },
      );
    async function handoff() {
      const result = await db.rpc("request_public_communication_handoff", {
        p_site_id: siteId,
        p_visitor_key: visitorKey,
      });
      if (result.error)
        return NextResponse.json(
          {
            error:
              "Your message was recorded, but handoff could not be recorded.",
          },
          { status: 503 },
        );
      return NextResponse.json({
        answer: result.data,
        unavailable: true,
        handoff: true,
      });
    }
    if (body.handoff === true) return handoff();
    const api = process.env.ASSISTANT_API_URL,
      secret = process.env.PUBLIC_CHAT_API_SECRET;
    if (!api || !secret) return handoff();
    try {
      const response = await fetch(`${api.replace(/\/$/, "")}/public_chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gold-public-chat-key": secret,
        },
        body: JSON.stringify({
          message,
          deploymentId: deployment.deploymentId,
          visitorKey,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) return handoff();
      const reply = (await response.json()) as {
        answer?: string;
        handoff?: boolean;
      };
      return NextResponse.json({
        answer: String(reply.answer ?? "").slice(0, 4000),
        handoff: Boolean(reply.handoff),
      });
    } catch {
      return handoff();
    }
  } catch {
    return NextResponse.json(
      { error: "Messaging is unavailable." },
      { status: 503 },
    );
  }
}
