import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foundBusiness } from "@/tests/support/founding";
import type { Db } from "@/lib/db/types";
import {
  commandSupport,
  readSupport,
  readSupportConfiguration,
  type RecordOption,
} from "@/lib/domain/support/support";
import { createCustomer } from "@/lib/domain/customers/customers";
import { createWorkItemType } from "@/lib/domain/work-items/types";
import { createWorkItemStatus } from "@/lib/domain/work-items/statuses";
import { createWorkItem } from "@/lib/domain/work-items/work-items";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Support fixtures require a local database");
const key = process.env.SUPABASE_ANON_KEY ?? "";
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pg = new Client(
  process.env.SUPABASE_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
);
let a: {
    db: Db;
    org: string;
    user: string;
    membership: string;
    customer: string;
    work: string;
  },
  b: typeof a;
let queue: string, policy: string, caseId: string;
async function tenant(label: string) {
  const email = `support-${label}-${randomUUID()}@example.test`,
    password = randomUUID();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as Db;
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const org = await foundBusiness({
    ownerEmail: email,
    name: `Support ${label}`,
    currency: "CAD",
    timezone: "America/Toronto",
  });
  const membership = (
    await db
      .from("memberships")
      .select("id")
      .eq("organization_id", org)
      .eq("user_id", created.data.user.id)
      .single()
  ).data!.id;
  const customer = await createCustomer(db, {
    organizationId: org,
    name: `${label} Support Customer`,
  });
  const typeId = await createWorkItemType(db, {
    organizationId: org,
    name: "Support follow-up",
    schedulable: false,
  });
  const statusId = await createWorkItemStatus(db, {
    organizationId: org,
    typeId,
    name: "New",
  });
  const work = await createWorkItem(db, {
    organizationId: org,
    title: "Inspect service problem",
    statusId,
    customerId: customer,
  });
  return { db, org, user: created.data.user.id, membership, customer, work };
}
describe("Support operating workspace", () => {
  beforeAll(async () => {
    await pg.connect();
    a = await tenant("a");
    b = await tenant("b");
    queue = await commandSupport(a.db, a.org, "queue.create", {
      name: "Technical requests",
      description: "Operational problems",
    });
    policy = await commandSupport(a.db, a.org, "policy.create", {
      name: "Urgent elapsed target",
      priority: "urgent",
      queue,
      minutes: 60,
    });
    caseId = await commandSupport(a.db, a.org, "case.create", {
      title: "Equipment fault",
      description: "A service problem requiring investigation.",
      priority: "urgent",
      customer: a.customer,
      queue,
      owner: a.membership,
      work_item: a.work,
    });
  });
  afterAll(async () => {
    await pg.end();
    await a?.db.auth.signOut();
    await b?.db.auth.signOut();
  });
  it("reads configuration definitions without loading operational case data", async () => {
    const data = await readSupportConfiguration(a.db, a.org);
    expect(data.queues).toContainEqual(expect.objectContaining({ id: queue }));
    expect(data.policies).toContainEqual(expect.objectContaining({ id: policy }));
    expect(data).not.toHaveProperty('cases');
    expect(data.queues[0]).not.toHaveProperty('open_count');
    const other = await readSupportConfiguration(b.db, a.org);
    expect(other).toEqual({ queues: [], policies: [] });
  });
  it("persists configuration, applies a queue-specific policy and preserves canonical links", async () => {
    const data = await readSupport(a.db, a.org, "detail", { selected: caseId });
    expect(data.selected).toMatchObject({
      case_number: "CASE-0001",
      priority: "urgent",
      queue_id: queue,
      assigned_membership_id: a.membership,
      customer_id: a.customer,
    });
    expect(data.selected!.target_snapshot).toMatchObject({
      name: "Urgent elapsed target",
      minutes: 60,
      clock: "elapsed",
    });
    expect(
      new Date(data.selected!.resolution_due_at!).getTime() -
        new Date(data.selected!.created_at).getTime(),
    ).toBe(3600000);
    expect(data.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "work_item", record_id: a.work }),
      ]),
    );
    expect(
      (
        await readSupport<RecordOption[]>(a.db, a.org, "search", {
          kind: "customer",
          q: "Support Customer",
        })
      ).some((c) => c.id === a.customer),
    ).toBe(true);
    expect(
      (await readSupport(a.db, a.org, "cases", { q: "Support Customer" }))
        .total,
    ).toBe(1);
  });
  it("validates transitions and meaningful resolution, preserving previous outcomes after reopening", async () => {
    await expect(
      commandSupport(a.db, a.org, "case.status", {
        id: caseId,
        status: "closed",
      }),
    ).rejects.toThrow("This case can’t move to that status from where it is now.");
    await expect(
      commandSupport(a.db, a.org, "case.resolve", {
        id: caseId,
        summary: "done",
      }),
    ).rejects.toThrow("meaningful");
    await commandSupport(a.db, a.org, "case.status", {
      id: caseId,
      status: "open",
    });
    await commandSupport(a.db, a.org, "case.note", {
      id: caseId,
      body: "Internal investigation only; do not send.",
    });
    await commandSupport(a.db, a.org, "case.priority", {
      id: caseId,
      priority: "high",
    });
    await commandSupport(a.db, a.org, "case.assign", {
      id: caseId,
      owner: "",
      queue,
    });
    await commandSupport(a.db, a.org, "case.escalate", {
      id: caseId,
      reason: "Requires specialist investigation.",
      priority: "urgent",
      owner: a.membership,
    });
    await commandSupport(a.db, a.org, "case.resolve", {
      id: caseId,
      summary: "Replaced the defective controller and tested operation.",
    });
    await commandSupport(a.db, a.org, "case.reopen", {
      id: caseId,
      reason: "Customer reports the fault returned after service.",
    });
    const reopened = await readSupport(a.db, a.org, "detail", {
      selected: caseId,
    });
    expect(reopened.selected!.status).toBe("open");
    expect(
      reopened.events.some(
        (e) => e.kind === "resolved" && e.body.includes("controller"),
      ),
    ).toBe(true);
    expect(
      reopened.events.some(
        (e) => e.kind === "note" && e.actor_name === "Founder",
      ),
    ).toBe(true);
    await commandSupport(a.db, a.org, "case.resolve", {
      id: caseId,
      summary: "Replaced wiring and confirmed stable operation with Customer.",
    });
    await commandSupport(a.db, a.org, "case.close", { id: caseId });
    await expect(
      commandSupport(a.db, a.org, "case.note", {
        id: caseId,
        body: "Cannot modify a closed Case",
      }),
    ).rejects.toThrow("Reopen");
    await expect(
      commandSupport(a.db, a.org, "case.reopen", { id: caseId }),
    ).rejects.toThrow("reason");
    await commandSupport(a.db, a.org, "case.reopen", {
      id: caseId,
      reason: "Authorized review of the earlier service outcome.",
    });
    expect(
      (
        await readSupport(a.db, a.org, "detail", { selected: caseId })
      ).events.filter((e) => e.kind === "resolved"),
    ).toHaveLength(2);
  });
  it("keeps historical deadlines after policy, queue and priority edits", async () => {
    const original = (
      await readSupport(a.db, a.org, "detail", { selected: caseId })
    ).selected!;
    await commandSupport(a.db, a.org, "policy.edit", {
      id: policy,
      name: "Changed policy",
      priority: "urgent",
      queue,
      minutes: 120,
      active: true,
    });
    await commandSupport(a.db, a.org, "case.priority", {
      id: caseId,
      priority: "normal",
    });
    const current = (
      await readSupport(a.db, a.org, "detail", { selected: caseId })
    ).selected!;
    expect(current.resolution_due_at).toBe(original.resolution_due_at);
    expect(current.target_snapshot).toEqual(original.target_snapshot);
    const next = await commandSupport(a.db, a.org, "case.create", {
      title: "New urgent target",
      priority: "urgent",
      queue,
    });
    expect(
      (await readSupport(a.db, a.org, "detail", { selected: next })).selected!
        .target_snapshot!.minutes,
    ).toBe(120);
  });
  it("refuses cross-tenant reads, mutations and every relationship type", async () => {
    expect(
      (
        await b.db
          .from("support_cases")
          .select("id")
          .eq("organization_id", a.org)
      ).data,
    ).toEqual([]);
    await expect(readSupport(b.db, a.org, "home")).rejects.toThrow(
      "permission",
    );
    await expect(
      commandSupport(b.db, a.org, "case.note", {
        id: caseId,
        body: "Intrusion",
      }),
    ).rejects.toThrow("permission");
    for (const input of [
      { customer: b.customer },
      {
        queue: await commandSupport(b.db, b.org, "queue.create", {
          name: "Other queue",
        }),
      },
      { owner: b.membership },
    ])
      await expect(
        commandSupport(a.db, a.org, "case.create", {
          title: "Invalid tenant reference",
          ...input,
        }),
      ).rejects.toThrow();
    await expect(
      commandSupport(a.db, a.org, "case.link", {
        id: caseId,
        work_item: b.work,
      }),
    ).rejects.toThrow();
    for (const kind of ["conversation", "call", "invoice", "asset", "location"])
      await expect(
        commandSupport(a.db, a.org, "case.link", {
          id: caseId,
          [kind]: randomUUID(),
        }),
      ).rejects.toThrow();
    expect(
      (
        await a.db
          .from("support_cases")
          .update({ title: "Bypass" })
          .eq("id", caseId)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await a.db
          .from("support_case_events")
          .update({ body: "Erased" })
          .eq("case_id", caseId)
      ).error,
    ).not.toBeNull();
    expect(
      (await a.db.from("support_case_events").delete().eq("case_id", caseId))
        .error,
    ).not.toBeNull();
    expect(
      (
        await a.db
          .from("support_case_events")
          .insert({
            organization_id: a.org,
            case_id: caseId,
            actor_id: a.user,
            actor_name: "Impersonated",
            kind: "note",
          })
      ).error,
    ).not.toBeNull();
  });
  it("allocates unique numbers under concurrency and returns exact totals and independent board previews", async () => {
    const ids = await Promise.all(
      Array.from({ length: 55 }, (_, i) =>
        commandSupport(b.db, b.org, "case.create", {
          title: `Backlog ${i}`,
          priority: i % 2 ? "normal" : "high",
        }),
      ),
    );
    const rows = (
      await b.db
        .from("support_cases")
        .select("case_number")
        .eq("organization_id", b.org)
    ).data!;
    expect(new Set(rows.map((r) => r.case_number)).size).toBe(55);
    for (const id of ids.slice(0, 3))
      await commandSupport(b.db, b.org, "case.resolve", {
        id,
        summary: "Completed the recorded support request.",
      });
    const data = await readSupport(b.db, b.org, "cases");
    expect(data.total).toBe(55);
    expect(data.cases).toHaveLength(25);
    expect(data.summary.open).toBe(52);
    expect(data.summary.resolved).toBe(3);
    expect(data.board.find((c) => c.status === "new")).toMatchObject({
      count: 52,
    });
    expect(data.board.find((c) => c.status === "new")!.cases).toHaveLength(8);
    expect(
      (await readSupport(b.db, b.org, "cases", { page: "3" })).cases,
    ).toHaveLength(5);
    expect(
      (await readSupport(b.db, b.org, "cases", { attention: "unassigned" }))
        .total,
    ).toBe(52);
    await pg.query(
      "update public.support_cases set resolution_due_at=now()-interval '1 hour' where organization_id=$1 and id=$2",
      [a.org, caseId],
    );
    expect(
      (
        await readSupport(a.db, a.org, "cases", { attention: "overdue" })
      ).cases.some((c) => c.id === caseId),
    ).toBe(true);
  });
  it("enforces independent read, creation, assignment, resolution and configuration permissions", async () => {
    const role = (
      await pg.query("select role_id from public.memberships where id=$1", [
        b.membership,
      ])
    ).rows[0].role_id;
    await pg.query(
      "update public.roles set capabilities=$1 where organization_id=$2 and id=$3",
      [["role.manage", "support.read"], b.org, role],
    );
    expect((await readSupport(b.db, b.org, "home")).summary.open).toBe(52);
    for (const command of [
      "case.create",
      "case.note",
      "case.assign",
      "case.resolve",
      "queue.create",
      "policy.create",
    ])
      await expect(
        commandSupport(b.db, b.org, command, {
          id: caseId,
          title: "Forbidden",
          body: "Forbidden",
          summary: "Forbidden resolution",
        }),
      ).rejects.toThrow("permission");
    await pg.query(
      "update public.roles set capabilities=$1 where organization_id=$2 and id=$3",
      [["role.manage", "support.read", "support.case.create"], b.org, role],
    );
    await expect(
      commandSupport(b.db, b.org, "case.create", {
        title: "Forbidden assignment",
        owner: b.membership,
      }),
    ).rejects.toThrow("Assignment permission");
    await pg.query(
      "update public.roles set capabilities=$1 where organization_id=$2 and id=$3",
      [["role.manage", "customer.create"], b.org, role],
    );
    expect((await b.db.from("support_case_events").select("id")).data).toEqual(
      [],
    );
    await expect(readSupport(b.db, b.org, "home")).rejects.toThrow(
      "permission",
    );
  });
});
