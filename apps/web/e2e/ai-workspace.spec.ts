import { mkdirSync } from "node:fs";
import { createWebsite, listSiteTemplates, publishSiteRevision, siteEditorState, submitSiteRevision } from "../lib/domain/public-site/public-site";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loadDemoContext, OWNER_STORAGE_STATE } from "./helpers";
import { DEMO_PASSWORD } from "../scripts/demo/businesses";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { ALL_CAPABILITIES } from "../lib/domain/tenancy/capabilities";

test.use({ storageState: OWNER_STORAGE_STATE, actionTimeout: 15000 });
const shots = path.resolve(__dirname, "../test-results/ai");
async function capture(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    fullPage: true,
  });
}

test("AI agent lifecycle, workbench, channel policies and responsive destinations", async ({
  page,
}) => {
  test.setTimeout(240000);
  const base = `/organizations/${loadDemoContext().organizationId}/ai`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  if (page.url().includes("/login")) {
    await page
      .getByLabel("Email", { exact: true })
      .fill(loadDemoContext().ownerEmail);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
    await page.goto(base);
    await page.context().storageState({ path: OWNER_STORAGE_STATE });
  }
  await expect(
    page.getByRole("heading", { name: "AI", exact: true }),
  ).toBeVisible();
  await capture(page, "home-before");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New agent", exact: true }),
  ).toBeVisible();
  await capture(page, "new-agent");
  const name = `Browser service ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Answers approved business FAQs and requests human assistance.");
  await page
    .getByLabel("Starting instructions")
    .fill(
      "Answer published business FAQs. Do not disclose private customer data. Ask a human when unsure.",
    );
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const agentUrl = page.url();
  await capture(page, "agent-overview");
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(page.getByText("Latest published v1")).toBeVisible();
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  await page
    .getByLabel("Tone & communication style")
    .fill("Warm, concise and direct.");
  await page
    .getByRole("button", { name: "Tools & permissions", exact: true })
    .click();
  await page.getByLabel("Work at risk").check();
  await capture(page, "tools-permissions");
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  await expect(page.getByLabel("Tone & communication style")).toHaveValue(
    "Warm, concise and direct.",
  );
  await capture(page, "instructions");
  await page.reload();
  await expect(page.getByLabel("Tone & communication style")).toHaveValue("Warm, concise and direct.");
  await expect(page.getByRole("status").filter({ hasText: "Recovered unsaved changes" })).toBeVisible();
  await page.goBack();
  await page.goForward();
  await expect(page.getByLabel("Tone & communication style")).toHaveValue("Warm, concise and direct.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Add channel", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Channel", exact: true })
    .selectOption("voice");
  await expect(
    page.getByText("Runtime unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Enable deployment/ }),
  ).toBeDisabled();
  await page
    .getByLabel("Communications phone/routing identity reference")
    .fill("Local verification only");
  await capture(page, "voice-configuration");
  await page
    .getByRole("button", { name: "Save deployment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Voice deployment", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(`${name} Voice`) })).toBeVisible();
  await capture(page, "channels");
  for (const section of ["Knowledge", "Handoff", "Testing", "Versions"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await capture(page, `agent-${section.toLowerCase()}`);
  }
  await page.getByRole("button", { name: /Version 1/ }).click();
  await expect(page.getByRole("heading", { name: "Published configuration", exact: true })).toBeVisible();
  await capture(page, "version-inspector");
  await page.getByRole("button", { name: /Close/ }).last().click();
  await page.getByRole("button", { name: "Testing", exact: true }).click();
  await page.getByLabel("Test question", { exact: true }).fill("What published information can you answer?");
  await page.getByLabel("Expected behavior", { exact: true }).fill("Explain missing knowledge without inventing facts.");
  await page.getByRole("button", { name: "Run safe preview", exact: true }).click();
  await expect(page.getByRole("alert").or(page.getByText("Human assessment required", { exact: true }))).toBeVisible();
  await expect(page.getByRole("button", { name: "Run safe preview", exact: true })).toBeVisible();
  await capture(page, "testing-result-state");
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("combobox", { name: "Configuration section" }).selectOption("instructions");
    await capture(page, `workbench-${width}`);
    await page.getByRole("combobox", { name: "Configuration section" }).selectOption("versions");
    await page.getByRole("button", { name: /Version 1/ }).click();
    await expect(page.getByRole("heading", { name: "Published configuration", exact: true })).toBeVisible();
    await capture(page, `version-inspector-${width}`);
    await page.getByRole("button", { name: /Close/ }).last().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of [
    "agents",
    "deployments",
    "knowledge",
    "tools",
    "activity",
    "evaluations",
  ]) {
    await page.goto(`${base}/${route}`);
    await capture(page, route);
  }
  await page.goto(base);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await capture(page, `home-${width}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => { for (const el of document.querySelectorAll<HTMLElement>("main, section, div")) if (el.scrollHeight > el.clientHeight && ["auto", "scroll"].includes(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; });
    await capture(page, `home-${width}-lower`);
    await page.evaluate(() => { for (const el of document.querySelectorAll<HTMLElement>("main, section, div")) if (["auto", "scroll"].includes(getComputedStyle(el).overflowY)) el.scrollTop = 0; });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message to the Agent" }),
  ).toBeVisible();
  await capture(page, "operator-rail");
  await page
    .getByRole("navigation", { name: "AI workspace" })
    .getByRole("link", { name: "Agents", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message to the Agent" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  // Deep links keep the editor route and version inspection accessible after navigation.
  expect(agentUrl).toContain("/ai/agents/");
  loadEnv({ path: path.resolve(__dirname, "../../../.env.test") });
  // Exercise the canonical provisioning command with a local platform staff fixture.
  // Browser runners cannot load the Vitest founding helper's application path aliases.
  const localUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  const connection = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (![localUrl, connection].every(value => ["127.0.0.1", "localhost"].includes(new URL(value).hostname))) throw new Error("Local fixture database required");
  const admin = createClient(localUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = `ai-browser-staff-${randomUUID()}@example.test`, password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const pg = new Client(connection);
  await pg.connect();
  try { await pg.query("insert into public.platform_staff(user_id,name) values($1,'AI browser fixture')", [created.data.user.id]); }
  finally { await pg.end(); }
  const staff = createClient(localUrl, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const signed = await staff.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const provisioned = await staff.rpc("provision_organization", { p_owner_email: loadDemoContext().ownerEmail, p_name: `AI empty browser ${Date.now()}`, p_role: "Admin", p_capabilities: ALL_CAPABILITIES, p_display_name: "Owner", p_timezone: "UTC", p_currency: "CAD" });
  if (provisioned.error) throw provisioned.error;
  const emptyOrganizationId = provisioned.data;
  await page.goto(`/organizations/${emptyOrganizationId}/ai`);
  await expect(page.getByRole("heading", { name: "AI", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Active agents/ })).toContainText("0");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await capture(page, `empty-home-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("published website fallback hands off to Communications and receives a staff reply", async ({ page, browser }) => {
  test.setTimeout(120000);
  loadEnv({ path: path.resolve(__dirname, "../../../.env.test") });
  const localUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  if (!["127.0.0.1", "localhost"].includes(new URL(localUrl).hostname)) throw new Error("Local test database required");
  const connection = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!["127.0.0.1", "localhost"].includes(new URL(connection).hostname)) throw new Error("Local fixture database required");
  const db = createClient(localUrl, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { organizationId, ownerEmail } = loadDemoContext();
  const signed = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const pg = new Client(connection);
  await pg.connect();
  let term: string | undefined, moduleAdded = false, deploymentId: string | undefined;
  const priorDomain = (await pg.query("select platform_public_domain from public.platform_settings where singleton")).rows[0].platform_public_domain;
  const visitor = await browser.newContext({ baseURL: String(test.info().project.use.baseURL ?? "http://localhost:3000") });
  try {
    const inserted = await pg.query("insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'assistant',$2) on conflict do nothing returning organization_id", [organizationId, signed.data.user!.id]);
    moduleAdded = inserted.rowCount === 1;
    term = (await pg.query("insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:assistant','2020-01-01','9999-12-31',1,0,null,$2,'local browser AI handoff test') returning id", [organizationId, signed.data.user!.id])).rows[0].id;
    await pg.query("update public.platform_settings set platform_public_domain='ai-browser.test' where singleton");
    // The journey needs a published website to ground and deploy on. It must not depend on another
    // spec having left one behind, so publish one through the supported operations when absent.
    let sites = (await db.rpc("ai_published_sites", { p_organization_id: organizationId })).data ?? [];
    if (!sites.length) {
      const templates = await listSiteTemplates(db as never);
      await createWebsite(db as never, { organizationId, templateKey: templates[0]?.key }).catch(() => undefined);
      const editor = await siteEditorState(db as never, organizationId);
      if (editor?.working) {
        await submitSiteRevision(db as never, organizationId, editor.working.id);
        await publishSiteRevision(db as never, organizationId, editor.working.id);
      }
      sites = (await db.rpc("ai_published_sites", { p_organization_id: organizationId })).data ?? [];
    }
    const site = sites[0].id;
    const saved = await db.rpc("save_ai_assistant", { p_organization_id: organizationId, p_id: null, p_name: `Browser website ${Date.now()}`, p_instructions: "Answer published FAQs only.", p_configuration: { tools: [], policy: "read_only" }, p_expected_draft: null });
    expect(saved.error).toBeNull();
    const published = await db.rpc("publish_ai_assistant", { p_organization_id: organizationId, p_id: saved.data, p_status: "active", p_expected_draft: 1 });
    expect(published.error).toBeNull();
    const deployment = { p_organization_id: organizationId, p_id: null as string | null, p_assistant_id: saved.data, p_version_id: published.data, p_surface: "website_chat", p_site_id: site, p_enabled: true, p_display_name: "Website service", p_greeting: "Hello. How can we help?", p_handoff: "Your request has been recorded for our team.", p_configuration: {} };
    const deployed = await db.rpc("save_ai_deployment", deployment);
    expect(deployed.error).toBeNull();
    deploymentId = deployed.data;
    const slug = (await pg.query("select slug from public.organizations where id=$1", [organizationId])).rows[0].slug;
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/sites/${slug}.ai-browser.test`);
    await publicPage.getByRole("button", { name: "Open messages", exact: true }).click();
    await publicPage.getByRole("textbox", { name: "Message to the business" }).fill("Browser visitor needs help");
    await publicPage.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(publicPage.getByText("Your request has been recorded for our team.", { exact: true })).toBeVisible();
    await expect(publicPage.getByText("Team follow-up requested", { exact: true })).toBeVisible();
    await capture(publicPage, "website-handoff");
    const thread = (await db.from("communication_threads").select("id").eq("assistant_deployment_id", deploymentId).order("created_at", { ascending: false }).limit(1)).data![0].id;
    await page.goto(`/organizations/${organizationId}/comms/inbox/website?thread=${thread}`);
    await page.getByRole("button", { name: "Claim", exact: true }).click();
    await page.getByRole("textbox", { name: "Website reply" }).fill("A team member is here to help.");
    await page.getByRole("button", { name: "Send website reply", exact: true }).click();
    await expect(page.getByText("A team member is here to help.", { exact: true })).toBeVisible();
    await expect(publicPage.getByText("A team member is here to help.", { exact: true })).toBeVisible({ timeout: 20000 });
    await capture(page, "communications-website-reply");
    await capture(publicPage, "website-staff-reply");
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(page.getByText(/resolved · anonymous visitor/)).toBeVisible();
    expect((await db.rpc("save_ai_deployment", { ...deployment, p_id: deploymentId, p_enabled: false })).error).toBeNull();
  } finally {
    if (deploymentId) await pg.query("update public.ai_assistant_deployments set enabled=false where id=$1", [deploymentId]);
    if (term) await pg.query("delete from public.organization_commercial_terms where id=$1", [term]);
    if (moduleAdded) await pg.query("delete from public.organization_modules where organization_id=$1 and module_key='assistant'", [organizationId]);
    await pg.query("update public.platform_settings set platform_public_domain=$1 where singleton", [priorDomain]);
    await pg.end();
    await visitor.close();
  }
});
