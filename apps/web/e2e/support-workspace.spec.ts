import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { loadDemoContext, OWNER_STORAGE_STATE } from "./helpers";
import { DEMO_PASSWORD } from "../scripts/demo/businesses";
import { foundBusiness } from "../tests/support/founding";
import { createCustomer } from "../lib/domain/customers/customers";
import { createWorkItemType } from "../lib/domain/work-items/types";
import { createWorkItemStatus } from "../lib/domain/work-items/statuses";
import { createWorkItem } from "../lib/domain/work-items/work-items";
import { commandSupport, readSupport } from "../lib/domain/support/support";
import type { Db } from "../lib/db/types";

const shots = path.resolve(__dirname, "../test-results/support");
async function capture(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    fullPage: true,
  });
  const inset = page.locator('[data-slot="sidebar-inset"]');
  if (
    (await inset.count()) &&
    (await inset.evaluate((el) => el.scrollHeight > el.clientHeight + 20))
  ) {
    const original = await inset.evaluate((el) => {
      const y = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      return y;
    });
    await page.screenshot({
      path: path.join(shots, `${name}-lower.png`),
      fullPage: true,
    });
    await inset.evaluate((el, y) => {
      el.scrollTop = y;
    }, original);
  }
}
test.use({ storageState: OWNER_STORAGE_STATE, actionTimeout: 15000 });
test("Support setup, case execution, cross-domain origins, reporting and responsive surfaces", async ({
  page,
}) => {
  test.setTimeout(240000);
  config({ path: path.resolve(__dirname, "../../../.env.test") });
  const url = process.env.SUPABASE_URL!,
    connectionString =
      process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  for (const address of [url, connectionString])
    if (!["localhost", "127.0.0.1"].includes(new URL(address).hostname))
      throw new Error("Local Support fixtures only");
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as Db;
  const signed = await db.auth.signInWithPassword({
    email: loadDemoContext().ownerEmail,
    password: DEMO_PASSWORD,
  });
  if (signed.error) throw signed.error;
  const organizationId = await foundBusiness({
    ownerEmail: loadDemoContext().ownerEmail,
    name: `Support browser ${randomUUID().slice(0, 6)}`,
    currency: "CAD",
    timezone: "America/Toronto",
    displayName: "Support operator",
  });
  const base = `/organizations/${organizationId}/support`,
    org = `/organizations/${organizationId}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Support", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible();
  await capture(page, "home-empty");
  // Destinations come from the contextual sidebar; configuration opens from Configure in the page header.
  const sidebar = () => page.getByRole("navigation", { name: "This business" });
  await sidebar().getByRole("link", { name: "Queues", exact: true }).click();
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByRole("button", { name: "+ New queue", exact: true }).click();
  await page
    .getByLabel("Queue name", { exact: true })
    .fill("Emergency Service");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Urgent service failures and operational follow-up.");
  await page.getByRole("button", { name: "Save queue", exact: true }).click();
  await expect(
    page.getByText("Emergency Service", { exact: true }).first(),
  ).toBeVisible();
  await sidebar().getByRole("link", { name: "Service levels", exact: true }).click();
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByRole("button", { name: "+ New policy", exact: true }).click();
  await page
    .getByLabel("Policy name", { exact: true })
    .fill("Urgent resolution");
  await page.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await page
    .getByLabel("Applicable queue", { exact: true })
    .selectOption({ label: "Emergency Service" });
  await page
    .getByLabel("Resolution target (minutes)", { exact: true })
    .fill("240");
  await capture(page, "policy-drawer");
  await page.getByRole("button", { name: "Save policy", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Urgent resolution", exact: true }),
  ).toBeVisible();
  await capture(page, "service-levels");
  const customer = await createCustomer(db, {
    organizationId,
    name: "Marie Tremblay",
    email: "marie@example.test",
  });
  const typeId = await createWorkItemType(db, {
    organizationId,
    name: "Service visit",
    schedulable: false,
  });
  const statusId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: "New",
  });
  const work = await createWorkItem(db, {
    organizationId,
    statusId,
    title: "Inspect heating system",
    customerId: customer,
  });
  const context = await readSupport(db, organizationId, "home"),
    queue = context.queues[0].id,
    owner = context.members[0].id;
  await page.goto(base);
  await page.getByRole("button", { name: "+ New Case", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("No heat in unit");
  await page
    .getByLabel("Description", { exact: true })
    .fill(
      "Customer reports the heating system stopped overnight. Investigate and restore service.",
    );
  await page.getByLabel("Search customer", { exact: true }).fill("Marie");
  await page
    .getByRole("dialog", { name: "New Case", exact: true })
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Select customer", { exact: true })
    .selectOption(customer);
  await page.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await page.getByLabel("Queue", { exact: true }).selectOption(queue);
  await page.getByLabel("Assignee", { exact: true }).selectOption(owner);
  await capture(page, "new-case-drawer");
  await page.getByRole("button", { name: "Create Case", exact: true }).click();
  await expect(page).toHaveURL(/support\/cases\/[\w-]+/);
  const caseId = page.url().split("/").pop()!;
  await expect(
    page.getByRole("heading", { name: /CASE-0001 · No heat/ }),
  ).toBeVisible();
  await page
    .getByLabel("Internal note", { exact: true })
    .fill("Contacted technician and confirmed the unit is safe to inspect.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByText(
      "Contacted technician and confirmed the unit is safe to inspect.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("priority for CASE-0001", { exact: true })
    .selectOption("high");
  await expect
    .poll(
      async () =>
        (await readSupport(db, organizationId, "detail", { selected: caseId }))
          .selected!.priority,
    )
    .toBe("high");
  await page.getByRole("button", { name: "Assign Case", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Assign Case", exact: true })
    .getByLabel("Assignee", { exact: true })
    .selectOption("");
  await page
    .getByRole("dialog", { name: "Assign Case", exact: true })
    .getByRole("button", { name: "Assign Case", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Escalate Case", exact: true })
    .click();
  await page
    .getByLabel("Escalation reason", { exact: true })
    .fill("Restore heat before the expected overnight temperature drop.");
  await page
    .getByRole("dialog", { name: "Escalate Case", exact: true })
    .getByLabel("Assignee", { exact: true })
    .selectOption(owner);
  await page
    .getByRole("dialog", { name: "Escalate Case", exact: true })
    .getByRole("button", { name: "Escalate Case", exact: true })
    .click();
  await page
    .getByLabel("status for CASE-0001", { exact: true })
    .selectOption("open");
  await page.getByRole("button", { name: "Link record", exact: true }).click();
  await page.getByLabel("Search work item", { exact: true }).fill("heating");
  await page
    .getByRole("dialog", { name: "Link record", exact: true })
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await page.getByLabel("Select work item", { exact: true }).selectOption(work);
  await page
    .getByRole("dialog", { name: "Link record", exact: true })
    .getByRole("button", { name: "Link record", exact: true })
    .click();
  await page
    .getByRole("link", { name: /work item · Inspect heating system/i })
    .click();
  await expect(page).toHaveURL(new RegExp(`/work/${work}`));
  await expect(
    page.getByRole("heading", { name: "Inspect heating system", exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/cases/${caseId}`);
  await capture(page, "case-detail");
  await page.getByRole("button", { name: "Resolve Case", exact: true }).click();
  await page
    .getByLabel("Resolution summary", { exact: true })
    .fill("Replaced the failed thermostat and confirmed heating is restored.");
  await capture(page, "resolution-drawer");
  await page
    .getByRole("dialog", { name: "Resolve Case", exact: true })
    .getByRole("button", { name: "Resolve Case", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /Case resolved CASE-0001/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reopen Case", exact: true }).click();
  await page
    .getByLabel("Reopening reason", { exact: true })
    .fill("Customer reports intermittent heating after the first repair.");
  await page
    .getByRole("dialog", { name: "Reopen Case", exact: true })
    .getByRole("button", { name: "Reopen Case", exact: true })
    .click();
  await expect(
    page
      .getByText(
        "Replaced the failed thermostat and confirmed heating is restored.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resolve Case", exact: true }).click();
  await page
    .getByLabel("Resolution summary", { exact: true })
    .fill("Repaired wiring and confirmed stable heating with the Customer.");
  await page
    .getByRole("dialog", { name: "Resolve Case", exact: true })
    .getByRole("button", { name: "Resolve Case", exact: true })
    .click();
  const pg = new Client({ connectionString });
  await pg.connect();
  let role: { id: string; capabilities: string[] } | undefined;
  try {
    await page.getByRole("button", { name: "Close Case", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm close", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await readSupport(db, organizationId, "detail", {
              selected: caseId,
            })
          ).selected!.status,
      )
      .toBe("closed");
    const number = (
      await pg.query(
        "insert into public.phone_numbers(organization_id,e164,origin,label,voice_inbound_enabled,sms_inbound_enabled) values($1,$2,'external','Local Support fixture',false,false) returning id",
        [
          organizationId,
          `+1416${Math.floor(1000000 + Math.random() * 8999999)}`,
        ],
      )
    ).rows[0].id;
    const conversation = (
      await pg.query(
        "insert into public.conversations(organization_id,phone_number_id,external_number,customer_id,last_message_preview) values($1,$2,'+14385550190',$3,'Heating problem needs follow-up') returning id",
        [organizationId, number, customer],
      )
    ).rows[0].id;
    await pg.query(
      "insert into public.messages(organization_id,conversation_id,direction,status,body) values($1,$2,'inbound','delivered','The heating problem returned. Please help.')",
      [organizationId, conversation],
    );
    await page.goto(`${org}/comms/inbox/${conversation}`);
    await page
      .getByRole("button", { name: "Create Support Case", exact: true })
      .click();
    await expect(
      page.getByLabel("Select customer", { exact: true }),
    ).toHaveValue(customer);
    await page
      .getByLabel("Title", { exact: true })
      .fill("Heating follow-up from Conversation");
    await page.getByLabel("Priority", { exact: true }).selectOption("urgent");
    await page.getByLabel("Queue", { exact: true }).selectOption(queue);
    await page
      .getByRole("dialog", { name: "New Case", exact: true })
      .getByLabel("Assignee", { exact: true })
      .selectOption(owner);
    await capture(page, "case-from-conversation");
    await page
      .getByRole("button", { name: "Create Case", exact: true })
      .click();
    await expect(page).toHaveURL(/support\/cases\/[\w-]+/, { timeout: 15000 });
    const linkedCase = page.url().split("/").pop()!;
    expect(
      (
        await readSupport(db, organizationId, "detail", {
          selected: linkedCase,
        })
      ).links.some((l) => l.record_id === conversation),
    ).toBe(true);
    const linkedData = await readSupport(db, organizationId, "detail", {
      selected: linkedCase,
    });
    expect(linkedData.selected).toMatchObject({
      customer_id: customer,
      queue_id: queue,
      assigned_membership_id: owner,
    });
    expect(linkedData.selected!.resolution_due_at).not.toBeNull();
    await page
      .getByLabel("Internal note", { exact: true })
      .fill(
        "Confirmed the original repair and scheduled a technician follow-up.",
      );
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(
      page.getByText(
        "Confirmed the original repair and scheduled a technician follow-up.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Resolve Case", exact: true })
      .click();
    await page
      .getByLabel("Resolution summary", { exact: true })
      .fill(
        "Confirmed the follow-up question and provided the service outcome.",
      );
    await page
      .getByRole("dialog", { name: "Resolve Case", exact: true })
      .getByRole("button", { name: "Resolve Case", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Resolve Case", exact: true }),
    ).toBeHidden();
    expect(
      (
        await db
          .from("conversations")
          .select("status")
          .eq("id", conversation)
          .single()
      ).data!.status,
    ).toBe("open");
    await page.getByRole("link", { name: /conversation ·/i }).click();
    await expect(page).toHaveURL(new RegExp(conversation));
    await page
      .getByRole("link", { name: /CASE-0002 · Heating follow-up/ })
      .click();
    await expect(page).toHaveURL(new RegExp(linkedCase));
    const call = (
      await pg.query(
        "insert into public.calls(organization_id,customer_id,direction,status,from_number,to_number,created_by) values($1,$2,'inbound','completed','+14385550190','+14165550190',$3) returning id",
        [organizationId, customer, signed.data.user!.id],
      )
    ).rows[0].id;
    await page.goto(`${org}/calls/${call}`);
    await expect(
      page.getByRole("button", { name: "Create Support Case", exact: true }),
    ).toBeVisible();
    const customers = await Promise.all(
      [
        "Alex Chen",
        "David Gagnon",
        "Sophie Martin",
        "Luc Bouchard",
        "Isabelle Roy",
      ].map((name) => createCustomer(db, { organizationId, name })),
    );
    const billingQueue = await commandSupport(
      db,
      organizationId,
      "queue.create",
      {
        name: "Billing & Payments",
        description: "Payment and account questions",
      },
    );
    await commandSupport(db, organizationId, "policy.create", {
      name: "High resolution",
      priority: "high",
      queue,
      minutes: 120,
      active: true,
    });
    for (let i = 0; i < 14; i++) {
      const id = await commandSupport(db, organizationId, "case.create", {
        title: [
          "Billing dispute",
          "AC not working",
          "Reschedule appointment",
          "Warranty claim",
          "Water leak in basement",
        ][i % 5],
        customer: customers[i % 5],
        priority: ["urgent", "high", "normal", "low"][i % 4],
        queue: i % 3 ? queue : i % 2 ? billingQueue : "",
        owner: i % 2 ? owner : "",
      });
      if (i % 4 === 1)
        await commandSupport(db, organizationId, "case.status", {
          id,
          status: "waiting",
        });
      if (i === 4 || i === 8)
        await pg.query(
          "update public.support_cases set resolution_due_at=now()-interval '1 hour' where organization_id=$1 and id=$2 and policy_id is not null",
          [organizationId, id],
        );
      if (i % 5 === 0)
        await commandSupport(db, organizationId, "case.escalate", {
          id,
          reason:
            "Specialist triage required for the recorded service problem.",
        });
    }
    await page.goto(base);
    await capture(page, "home-populated");
    for (const width of [1672, 1440, 768, 390]) {
      await page.setViewportSize({
        width,
        height: width === 1672 ? 941 : 1050,
      });
      await page.goto(base);
      await expect(
        page.getByRole("heading", { name: "Support", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await capture(page, `home-${width}`);
      if (width === 1672) {
        const workbench = page.getByRole("region", { name: "Case workbench" });
        await expect(
          workbench.getByRole("link", { name: /CASE-/ }),
        ).toHaveCount(8);
        const rows = await workbench.locator("tbody tr").all();
        const lastRow = await rows.at(-1)!.boundingBox();
        expect(lastRow!.y + lastRow!.height).toBeLessThan(941);
        await page
          .getByRole("button", { name: "Priority: Priority", exact: true })
          .click();
        await page.getByRole("radio", { name: "Urgent", exact: true }).click();
        await expect(page).toHaveURL(/priority=urgent/);
        await expect(
          page.getByRole("button", { name: "Priority: Urgent", exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("button", { name: "Priority: Urgent", exact: true }),
        ).toBeVisible();
        await page.goto(base);
        await page
          .getByRole("button", { name: "Reporting period", exact: true })
          .click();
        await expect(
          page.getByLabel("From date", { exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await page
          .getByRole("button", { name: "Dismiss SLA alert", exact: true })
          .click();
        await expect(
          page.getByText("2 cases have breached SLA", { exact: true }),
        ).toHaveCount(0);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`${base}/cases`);
    await capture(page, "cases-list");
    const activeCase = (
      await readSupport(db, organizationId, "cases", { status: "active" })
    ).cases[0];
    await page
      .getByRole("button", {
        name: `Actions for ${activeCase.case_number}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Escalate Case", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Escalate Case", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page).toHaveURL(/view=board/);
    await capture(page, "cases-board");
    await page.goto(`${base}/queues?queue=${queue}&selected=${caseId}`);
    await capture(page, "queue-workbench");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "queue-mobile");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`${base}/reports`);
    await capture(page, "reports");
    await page.goto(base);
    await page
      .getByRole("link", { name: /Overdue Cases/ })
      .first()
      .click();
    await expect(page).toHaveURL(/attention=overdue/);
    expect(
      (await readSupport(db, organizationId, "cases", { attention: "overdue" }))
        .total,
    ).toBeGreaterThan(0);
    expect(
      (
        await db
          .from("work_items")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
      ).count,
    ).toBe(1);
    role = (
      await pg.query(
        "select r.id,r.capabilities from public.roles r join public.memberships m on (m.organization_id,m.role_id)=(r.organization_id,r.id) where m.id=$1",
        [owner],
      )
    ).rows[0];
    await pg.query(
      "update public.roles set capabilities=$1 where organization_id=$2 and id=$3",
      [["role.manage", "support.read"], organizationId, role!.id],
    );
    await page.goto(base);
    await expect(
      page.getByRole("button", { name: "+ New Case", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${base}/cases/${activeCase.id}`);
    await expect(
      page.getByRole("button", { name: "Resolve Case", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add note", exact: true }),
    ).toHaveCount(0);
    await capture(page, "case-read-only");
    await page.goto(`${base}/service-levels`);
    await expect(
      page.getByRole("button", { name: "+ New policy", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (role)
      await pg.query(
        "update public.roles set capabilities=$1 where organization_id=$2 and id=$3",
        [role.capabilities, organizationId, role.id],
      );
    await pg.end();
    await db.auth.signOut();
  }
});
