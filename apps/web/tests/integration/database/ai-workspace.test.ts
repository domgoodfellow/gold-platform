import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { foundBusiness } from "@/tests/support/founding";
import { createRole } from "@/lib/domain/tenancy/roles";
import { addMember } from "@/lib/domain/tenancy/members";
import { Client } from 'pg';
import {
  createWebsite,
  listSiteTemplates,
  siteEditorState,
  submitSiteRevision,
  publishSiteRevision,
} from "@/lib/domain/public-site/public-site";
import {
  deploymentReadiness,
  type Agent,
  type Deployment,
} from "@/lib/domain/ai/agents";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.SUPABASE_ANON_KEY ?? "";
let mine: SupabaseClient,
  other: SupabaseClient,
  org: string,
  otherOrg: string,
  agentId: string,
  versionId: string;
async function tenant(label: string) {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  });
  const email = `ai-${label}-${randomUUID()}@example.test`,
    password = randomUUID();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `AI ${label}`,
    currency: "CAD",
  });
  return { db, organizationId };
}
beforeAll(async () => {
  const a = await tenant("owner"),
    b = await tenant("other");
  mine = a.db;
  org = a.organizationId;
  other = b.db;
  otherOrg = b.organizationId;
}, 90000);
describe("one governed agent resource", () => {
  it("creates a draft through the authorized command", async () => {
    const result = await mine.rpc("save_ai_assistant", {
      p_organization_id: org,
      p_id: null,
      p_name: "Customer service",
      p_instructions: "Answer published FAQs. Request human help when unsure.",
      p_configuration: { policy: "read_only", tools: [] },
      p_expected_draft: null,
    });
    expect(result.error).toBeNull();
    agentId = result.data;
    const row = await mine
      .from("ai_assistants")
      .select("*")
      .eq("id", agentId)
      .single();
    expect(row.data.status).toBe("draft");
  });
  it("denies cross-tenant reads and commands", async () => {
    expect(
      (await other.from("ai_assistants").select("id").eq("id", agentId)).data,
    ).toEqual([]);
    expect(
      (
        await other.rpc("save_ai_assistant", {
          p_organization_id: org,
          p_id: agentId,
          p_name: "Hijacked",
          p_instructions: "",
          p_configuration: {},
          p_expected_draft: 1,
        })
      ).error?.code,
    ).toBe("42501");
  });
  it("denies anonymous mutation and direct table insertion", async () => {
    const anon = createClient(url, key, { auth: { persistSession: false } });
    expect(
      (
        await anon.rpc("save_ai_assistant", {
          p_organization_id: org,
          p_id: null,
          p_name: "Bad",
          p_instructions: "",
          p_configuration: {},
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await mine
          .from("ai_assistants")
          .insert({ organization_id: org, name: "Bypass" })
      ).error,
    ).toBeTruthy();
  });
  it("rejects unregistered tools and unsupported autonomy", async () => {
    for (const configuration of [
      { tools: ["arbitrary_http"] },
      { policy: "autonomous", tools: [] },
    ]) {
      expect(
        (
          await mine.rpc("save_ai_assistant", {
            p_organization_id: org,
            p_id: agentId,
            p_name: "Customer service",
            p_instructions: "Hi",
            p_configuration: configuration,
            p_expected_draft: 1,
          })
        ).error?.code,
      ).toBe("22023");
    }
  });
  it("publishes immutable version evidence", async () => {
    const result = await mine.rpc("publish_ai_assistant", {
      p_organization_id: org,
      p_id: agentId,
      p_status: "active",
      p_expected_draft: 1,
    });
    expect(result.error).toBeNull();
    versionId = result.data;
    expect(
      (
        await mine
          .from("ai_assistant_versions")
          .update({ instructions: "Rewrite history" })
          .eq("id", versionId)
      ).error,
    ).toBeTruthy();
  });
  it("detects concurrent draft saves and preserves deployed instructions", async () => {
    const input = {
      p_organization_id: org,
      p_id: agentId,
      p_name: "Customer service",
      p_instructions: "New draft instructions",
      p_configuration: { tools: [], policy: "read_only" },
      p_expected_draft: 1,
    };
    expect((await mine.rpc("save_ai_assistant", input)).error).toBeNull();
    expect((await mine.rpc("save_ai_assistant", input)).error?.code).toBe(
      "P0001",
    );
    const historical = await mine
      .from("ai_assistant_versions")
      .select("instructions")
      .eq("id", versionId)
      .single();
    expect(historical.data!.instructions).toContain("published FAQs");
  });
  it("associates the same agent with SMS, email, Support, voice and Portal without enabling absent runtimes", async () => {
    for (const surface of [
      "sms",
      "email",
      "support",
      "voice",
      "customer_portal",
    ]) {
      const input = {
        p_organization_id: org,
        p_id: null,
        p_assistant_id: agentId,
        p_version_id: versionId,
        p_surface: surface,
        p_site_id: null,
        p_enabled: false,
        p_display_name: "Customer service",
        p_greeting: "Hello",
        p_handoff: "Ask the team",
        p_configuration: {},
      };
      expect((await mine.rpc("save_ai_deployment", input)).error).toBeNull();
      expect(
        (await mine.rpc("save_ai_deployment", { ...input, p_enabled: true }))
          .error?.code,
      ).toBe("42501");
    }
    const rows = await mine
      .from("ai_assistant_deployments")
      .select("assistant_id")
      .eq("organization_id", org);
    expect(rows.data).toHaveLength(5);
    expect(new Set(rows.data!.map((d) => d.assistant_id)).size).toBe(1);
  });
  it("rejects another agent version, cross-tenant sites and stale lifecycle writes", async () => {
    expect(
      (
        await mine.rpc("set_ai_knowledge", {
          p_organization_id: org,
          p_assistant_id: agentId,
          p_site_id: randomUUID(),
          p_enabled: true,
        })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await other.rpc("save_ai_deployment", {
          p_organization_id: otherOrg,
          p_id: null,
          p_assistant_id: agentId,
          p_version_id: versionId,
          p_surface: "sms",
          p_site_id: null,
          p_enabled: false,
          p_display_name: "Bad",
          p_greeting: "Hi",
          p_handoff: "Help",
          p_configuration: {},
        })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await mine.rpc("publish_ai_assistant", {
          p_organization_id: org,
          p_id: agentId,
          p_status: "disabled",
          p_expected_draft: 1,
        })
      ).error?.code,
    ).toBe("P0001");
  });
  it("keeps preview access tenant scoped and evaluations personal", async () => {
    expect(
      (
        await other.rpc("ai_preview_configuration", {
          p_organization_id: org,
          p_assistant_id: agentId,
          p_version_id: versionId,
        })
      ).error?.code,
    ).toBe("42501");
    const result = await mine.rpc("ai_preview_configuration", {
      p_organization_id: org,
      p_assistant_id: agentId,
      p_version_id: versionId,
    });
    expect(result.error).toBeNull();
    expect(result.data.instructions).toContain("published FAQs");
    const record = await mine
      .from("ai_assistant_evaluations")
      .insert({
        organization_id: org,
        assistant_id: agentId,
        version_id: versionId,
        scenario: "Test",
        criterion: "Refuse private data",
        answer: "No private data",
        outcome: "answered",
      })
      .select("id")
      .single();
    expect(record.error).toBeNull();
    expect(
      (
        await other
          .from("ai_assistant_evaluations")
          .select("id")
          .eq("id", record.data!.id)
      ).data,
    ).toEqual([]);
  });
  it("does not call configuration an operational voice runtime", () => {
    const state = deploymentReadiness(
      { surface: "voice", enabled: true } as Deployment,
      { status: "active" } as Agent,
      true,
      true,
    );
    expect(state.state).toBe("Unavailable");
  });

  it("grounds public configuration only in selected published sources and completes human handoff", async () => {
    const pg = new Client(
      process.env.SUPABASE_DB_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    await pg.connect();
    const owner = (await mine.auth.getUser()).data.user!;
    try {
      await pg.query(
        `insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'assistant',$2) on conflict do nothing`,
        [org, owner.id],
      );
      await pg.query(
        `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:assistant','2020-01-01','9999-12-31',1,0,null,$2,'local AI test')`,
        [org, owner.id],
      );
      const templates = await listSiteTemplates(mine as never);
      await createWebsite(mine as never, {
        organizationId: org,
        templateKey: templates[0]?.key,
      });
      const state = await siteEditorState(mine as never, org);
      const site = state!.siteId;
      await submitSiteRevision(mine as never, org, state!.working!.id);
      await publishSiteRevision(mine as never, org, state!.working!.id);
      expect(
        (
          await mine.rpc("set_ai_knowledge", {
            p_organization_id: org,
            p_assistant_id: agentId,
            p_site_id: site,
            p_enabled: true,
          })
        ).error,
      ).toBeNull();
      const published = await mine.rpc("publish_ai_assistant", {
        p_organization_id: org,
        p_id: agentId,
        p_status: "active",
        p_expected_draft: 3,
      });
      expect(published.error).toBeNull();
      const input = {
        p_organization_id: org,
        p_id: null,
        p_assistant_id: agentId,
        p_version_id: published.data,
        p_surface: "website_chat",
        p_site_id: site,
        p_enabled: true,
        p_display_name: "Test service",
        p_greeting: "Hello",
        p_handoff: "Your request is with the team.",
        p_configuration: {},
      };
      const deployed = await mine.rpc("save_ai_deployment", input);
      expect(deployed.error).toBeNull();
      const anon = createClient(url, key, { auth: { persistSession: false } }),
        visitor = randomUUID();
      const recorded = await anon.rpc("record_public_communication", {
        p_site_id: site,
        p_visitor_key: visitor,
        p_body: "Please help",
      });
      expect(recorded.error).toBeNull();
      const publicConfiguration = await anon.rpc("public_assistant_deployment", { p_site_id: site });
      expect(publicConfiguration.data).not.toHaveProperty("instructions");
      expect(publicConfiguration.data).not.toHaveProperty("configuration");
      const floodVisitor = randomUUID();
      for (let n = 0; n < 20; n++) expect((await anon.rpc("record_public_communication", { p_site_id: site, p_visitor_key: floodVisitor, p_body: "Bounded visitor message" })).error).toBeNull();
      expect((await anon.rpc("record_public_communication", { p_site_id: site, p_visitor_key: floodVisitor, p_body: "Over limit" })).error?.code).toBe("54000");
      const thread = await mine
        .from("communication_threads")
        .select("*")
        .eq("id", recorded.data)
        .single();
      expect(thread.data.assistant_version_id).toBe(published.data);
      const visitor2 = randomUUID();
      expect(
        (
          await anon.rpc("public_communication_history", {
            p_site_id: site,
            p_visitor_key: visitor2,
          })
        ).data,
      ).toBeNull();
      expect(
        (
          await anon.rpc("record_public_communication_reply", {
            p_site_id: site,
            p_visitor_key: visitor,
            p_body: "Forged reply",
            p_handoff: false,
          })
        ).error,
      ).toBeTruthy();
      await pg.query("select public.record_public_communication_reply($1,$2,$3,false)", [site, visitor, "Published opening hours are on our website."]);
      await anon.rpc("record_public_communication", { p_site_id: site, p_visitor_key: visitor, p_body: "What about tomorrow?" });
      const groundedTurn = await pg.query("select public.resolve_public_agent_turn($1,$2) turn", [deployed.data, visitor]);
      expect(groundedTurn.rows[0].turn.history[0].question).toBe("Please help");
      expect(groundedTurn.rows[0].turn.history[0].answer).toContain("opening hours");
      expect(
        (
          await anon.rpc("request_public_communication_handoff", {
            p_site_id: site,
            p_visitor_key: visitor,
          })
        ).data,
      ).toBe("Your request is with the team.");
      expect(
        (
          await other.rpc("handle_website_conversation", {
            p_organization_id: org,
            p_thread_id: recorded.data,
            p_action: "claim",
          })
        ).error?.code,
      ).toBe("42501");
      expect(
        (
          await mine.rpc("handle_website_conversation", {
            p_organization_id: org,
            p_thread_id: recorded.data,
            p_action: "reply",
            p_body: "Team reply",
          })
        ).error?.code,
      ).toBe("42501");
      expect(
        (
          await mine.rpc("handle_website_conversation", {
            p_organization_id: org,
            p_thread_id: recorded.data,
            p_action: "claim",
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await mine.rpc("handle_website_conversation", {
            p_organization_id: org,
            p_thread_id: recorded.data,
            p_action: "reply",
            p_body: "Team reply",
          })
        ).error,
      ).toBeNull();
      const history = await anon.rpc("public_communication_history", {
        p_site_id: site,
        p_visitor_key: visitor,
      });
      expect(history.data.state).toBe("claimed");
      expect(history.data.entries.at(-1).body).toBe("Team reply");
      await expect(pg.query("select public.record_public_communication_reply($1,$2,$3,false)", [site, visitor, "Late AI reply"])).rejects.toThrow("unavailable for automated replies");
      const count = await mine
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org);
      expect(count.count).toBe(0);
      const knowledge = await pg.query(
        "select app.ai_published_knowledge($1,array[$2::uuid]) text",
        [org, site],
      );
      expect(knowledge.rows[0].text).toContain(state!.working!.id);
      expect(
        (
          await pg.query(
            "select app.ai_published_knowledge($1,array[$2::uuid]) text",
            [otherOrg, site],
          )
        ).rows[0].text,
      ).toBe("");
    } finally {
      await pg.end();
    }
  });
  it("permits tenant readers to inspect configuration but refuses management and previews", async () => {
    const roleId = await createRole(mine as never, { organizationId: org, name: "AI reader", capabilities: ["assistant.ask"] });
    await addMember(mine as never, { organizationId: org, email: (await other.auth.getUser()).data.user!.email!, roleId });
    expect((await other.from("ai_assistants").select("id").eq("id", agentId)).data).toHaveLength(1);
    expect((await other.rpc("save_ai_assistant", { p_organization_id: org, p_id: agentId, p_name: "Forbidden", p_instructions: "", p_configuration: {}, p_expected_draft: 3 })).error?.code).toBe("42501");
    expect((await other.rpc("ai_preview_configuration", { p_organization_id: org, p_assistant_id: agentId, p_version_id: versionId })).error?.code).toBe("42501");
    expect((await other.rpc("delete_ai_assistant", { p_organization_id: org, p_id: agentId })).error?.code).toBe("42501");
  });
  it("deletes unused drafts and disabled deployments but retains published history", async () => {
    const draft = await mine.rpc("save_ai_assistant", { p_organization_id: org, p_id: null, p_name: "Disposable", p_instructions: "", p_configuration: {}, p_expected_draft: null });
    expect((await mine.rpc("delete_ai_assistant", { p_organization_id: org, p_id: draft.data })).error).toBeNull();
    expect((await mine.from("ai_assistants").select("id").eq("id", draft.data)).data).toEqual([]);
    expect((await mine.rpc("delete_ai_assistant", { p_organization_id: org, p_id: agentId })).error).toBeTruthy();
    const deployment = await mine.rpc("save_ai_deployment", { p_organization_id: org, p_id: null, p_assistant_id: agentId, p_version_id: versionId, p_surface: "voice", p_site_id: null, p_enabled: false, p_display_name: "Disposable", p_greeting: "Hello", p_handoff: "Help", p_configuration: {} });
    expect(deployment.error).toBeNull();
    expect((await mine.rpc("delete_ai_deployment", { p_organization_id: org, p_id: deployment.data })).error).toBeNull();
  });
  it("pins an operator conversation to its original version without exposing another person's conversation", async () => {
    const latest = (await mine.from("ai_assistant_versions").select("id").eq("assistant_id", agentId).order("version_number", { ascending: false }).limit(1)).data![0].id;
    const deployment = { p_organization_id: org, p_id: null as string | null, p_assistant_id: agentId, p_version_id: versionId, p_surface: "operator_copilot", p_site_id: null, p_enabled: true, p_display_name: "Operator", p_greeting: "Hello", p_handoff: "Help", p_configuration: {} };
    const configured = await mine.rpc("save_ai_deployment", deployment);
    expect(configured.error).toBeNull();
    const userId = (await mine.auth.getUser()).data.user!.id;
    const conversation = await mine.from("agent_conversations").insert({ organization_id: org, created_by: userId, title: "Version continuity" }).select("id").single();
    expect(conversation.error).toBeNull();
    const run = await mine.from("agent_runs").insert({ organization_id: org, created_by: userId, conversation_id: conversation.data!.id, question: "Hello", answer: "Hello", outcome: "answered", tools: [], answered_by: "test", assistant_version_id: versionId, assistant_deployment_id: configured.data });
    expect(run.error).toBeNull();
    expect((await mine.rpc("save_ai_deployment", { ...deployment, p_id: configured.data, p_version_id: latest })).error).toBeNull();
    const current = await mine.rpc("resolve_operator_agent_turn", { p_organization_id: org });
    const pinned = await mine.rpc("resolve_operator_agent_turn", { p_organization_id: org, p_conversation_id: conversation.data!.id });
    expect(current.data.versionId).toBe(latest);
    expect(pinned.data.versionId).toBe(versionId);
    expect((await other.rpc("resolve_operator_agent_turn", { p_organization_id: org, p_conversation_id: conversation.data!.id })).error?.code).toBe("42501");
    expect((await mine.rpc("save_ai_deployment", { ...deployment, p_id: configured.data, p_version_id: latest, p_enabled: false })).error).toBeNull();
    expect((await mine.rpc("resolve_operator_agent_turn", { p_organization_id: org, p_conversation_id: conversation.data!.id })).data.enabled).toBe(false);
  });
});
