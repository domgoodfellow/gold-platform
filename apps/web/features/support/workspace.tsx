"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  Users,
  TriangleAlert,
  CircleCheck,
  Settings,
  Search,
  MoreHorizontal,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@gold/ui/components/popover";
import { AppPage } from "@/components/layout/app-page";
import { PageLocation } from "@/components/navigation/page-location";
import { Button, ButtonLink } from "@/components/controls/button";
import { TextInput, SelectInput } from "@/components/controls/inputs";
import {
  PRIORITIES,
  STATUSES,
  recordHref,
  type CaseEvent,
  type SupportCase,
  type SupportData,
} from "@/lib/domain/support/support";
import {
  CaseActions,
  CaseDrawer,
  ConfigurationEditor,
  InternalNote,
  NewCase,
  QuickChange,
} from "./editors";
import { Badge, Empty, Panel, Table, cell, formatTime } from "./ui";
import { SupportHome, SupportViews } from "./home";
import {
  OperationalTable,
  OwnerIdentity,
  RelativeTime,
} from "@/components/operational/primitives";

export type SupportView =
  | "home"
  | "cases"
  | "detail"
  | "queues"
  | "policies"
  | "reports";
const titles: Record<SupportView, string> = {
  home: "Support",
  cases: "Cases",
  detail: "Case",
  queues: "Queues",
  policies: "Service levels",
  reports: "Support reports",
};

export function SupportWorkspace({
  organizationId,
  timezone,
  capabilities,
  view,
  data,
}: {
  organizationId: string;
  timezone: string;
  capabilities: string[];
  view: SupportView;
  data: SupportData;
}) {
  const base = `/organizations/${organizationId}/support`,
    router = useRouter(),
    pathname = usePathname(),
    query = useSearchParams();
  const can = (cap: string) => capabilities.includes(cap);
  const period = new URLSearchParams({
    from: data.period.from,
    to: data.period.to,
  });
  const href = (path: string, filters: Record<string, string> = {}) => {
    const p = new URLSearchParams(period);
    Object.entries(filters).forEach(([k, v]) => p.set(k, v));
    return `${base}${path ? `/${path}` : ""}?${p}`;
  };
  const change = (values: Record<string, string>) => {
    const p = new URLSearchParams(query);
    p.delete("page");
    Object.entries(values).forEach(([k, v]) => {
      if (v) p.set(k, v);
      else p.delete(k);
    });
    router.push(`${pathname}?${p}`);
  };
  const c = data.selected,
    summary = data.summary;
  const kpis: [
    string,
    number,
    typeof ClipboardList,
    Record<string, string>,
    string,
  ][] = [
    ["Open Cases", summary.open, ClipboardList, { status: "active" }, "blue"],
    [
      "Unassigned Cases",
      summary.unassigned,
      Users,
      { attention: "unassigned" },
      "amber",
    ],
    [
      "Overdue Cases",
      summary.overdue,
      TriangleAlert,
      { attention: "overdue" },
      "rose",
    ],
    [
      "Resolved Cases",
      summary.resolved,
      CircleCheck,
      { period: "resolved" },
      "emerald",
    ],
  ];
  const due = (item: SupportCase) => (
    <RelativeTime
      value={item.resolution_due_at}
      deadline
      stacked
      active={["new", "open", "waiting"].includes(item.status)}
      timezone={timezone}
    />
  );
  const page = Number(query.get("page") ?? 1);
  const pagination = (total: number) => (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted">
      <span>
        {total === 0
          ? "0 Cases"
          : `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${total} Cases`}
      </span>
      <div className="flex gap-1">
        <Button
          size="tiny"
          tone="secondary"
          disabled={page <= 1}
          onClick={() => {
            const p = new URLSearchParams(query);
            p.set("page", String(page - 1));
            router.push(`${pathname}?${p}`);
          }}
        >
          Previous
        </Button>
        <Button
          size="tiny"
          tone="secondary"
          disabled={page * 25 >= total}
          onClick={() => {
            const p = new URLSearchParams(query);
            p.set("page", String(page + 1));
            router.push(`${pathname}?${p}`);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
  const caseTable = (items: SupportCase[], select = false) => (
    <>
      <div className="hidden md:block">
        <OperationalTable
          headings={[
            "Case",
            "Customer",
            "Queue",
            "Priority",
            "Status",
            "Owner",
            "SLA target",
            "Updated",
            "",
          ]}
          widths={["15%", "15%", "11%", "8%", "12%", "12%", "11%", "9%", "7%"]}
          hasRows={items.length > 0}
          empty="No Cases match this view."
        >
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-surface/60">
              <td className={cell}>
                <Link
                  href={
                    select
                      ? `${pathname}?${new URLSearchParams({ ...Object.fromEntries(query), selected: item.id })}`
                      : `${base}/cases/${item.id}`
                  }
                  className="font-semibold hover:text-blue-600"
                >
                  {item.case_number}
                </Link>
                <div
                  className="mt-0.5 max-w-48 truncate text-muted"
                  title={item.title}
                >
                  {item.title}
                </div>
              </td>
              <td className={cell}>
                {item.customer_id ? (
                  <Link
                    className="hover:text-blue-600"
                    href={recordHref(
                      organizationId,
                      "customer",
                      item.customer_id,
                    )}
                  >
                    {item.customer_name ?? "Customer"}
                  </Link>
                ) : (
                  <span className="text-muted">Internal request</span>
                )}
              </td>
              <td className={cell}>{item.queue_name ?? "No queue"}</td>
              <td className={cell}>
                <Badge value={item.priority} />
              </td>
              <td className={cell}>
                <Badge value={item.status} />
              </td>
              <td className={cell}>
                <OwnerIdentity name={item.owner_name} />
              </td>
              <td className={`${cell} whitespace-nowrap`}>{due(item)}</td>
              <td className={cell}>
                <RelativeTime value={item.updated_at} timezone={timezone} />
              </td>
              <td className={cell}>
                <div className="flex items-center gap-2">
                  <RowActions
                    organizationId={organizationId}
                    c={item}
                    data={data}
                    can={can}
                  />
                </div>
              </td>
            </tr>
          ))}
        </OperationalTable>
      </div>
      <div className="divide-y divide-border md:hidden">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2 p-3">
            <Link
              className="text-sm font-semibold"
              href={
                select
                  ? `${pathname}?${new URLSearchParams({ ...Object.fromEntries(query), selected: item.id })}`
                  : `${base}/cases/${item.id}`
              }
            >
              {item.case_number} · {item.title}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Badge value={item.priority} />
              <Badge value={item.status} />
              <span className="text-xs text-muted">
                {item.owner_name ?? "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-xs">
              <span>{item.queue_name ?? "No queue"}</span>
              {due(item)}
            </div>
            <div className="flex gap-2">
              <Link
                href={`${base}/cases/${item.id}`}
                className="text-xs text-blue-600"
              >
                Open Case
              </Link>
              <RowActions
                organizationId={organizationId}
                c={item}
                data={data}
                can={can}
              />
            </div>
          </div>
        ))}
        {!items.length && <Empty>No Cases match this view.</Empty>}
      </div>
    </>
  );
  const toolbar = (
    <form
      className="grid gap-2 border-b border-border p-3 sm:grid-cols-2 xl:flex xl:flex-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        change(
          Object.fromEntries(
            [
              "q",
              "status",
              "priority",
              "queue",
              "owner",
              "sort",
              "period",
              "attention",
            ].map((k) => [k, String(form.get(k) ?? "")]),
          ),
        );
      }}
    >
      <div className="relative min-w-0 sm:col-span-2 xl:min-w-56 xl:flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
        <TextInput
          name="q"
          aria-label="Search Cases"
          defaultValue={query.get("q") ?? ""}
          key={query.get("q")}
          placeholder="Search Cases, Customers, or identifiers…"
          className="pl-8"
        />
      </div>
      <SelectInput
        name="status"
        aria-label="Filter status"
        defaultValue={query.get("status") ?? ""}
      >
        <option value="">All statuses</option>
        <option value="active">Active Cases</option>
        {STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </SelectInput>
      <SelectInput
        name="priority"
        aria-label="Filter priority"
        defaultValue={query.get("priority") ?? ""}
      >
        <option value="">All priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </SelectInput>
      <SelectInput
        name="queue"
        aria-label="Filter queue"
        defaultValue={query.get("queue") ?? ""}
      >
        <option value="">All queues</option>
        <option value="none">No queue</option>
        {data.queues.map((q) => (
          <option key={q.id} value={q.id}>
            {q.name}
          </option>
        ))}
      </SelectInput>
      <SelectInput
        name="owner"
        aria-label="Filter assignee"
        defaultValue={query.get("owner") ?? ""}
      >
        <option value="">All owners</option>
        <option value="unassigned">Unassigned</option>
        {data.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectInput>
      <SelectInput
        name="sort"
        aria-label="Sort Cases"
        defaultValue={query.get("sort") ?? ""}
      >
        <option value="">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="due">SLA target</option>
      </SelectInput>
      <SelectInput
        name="period"
        aria-label="Case date basis"
        defaultValue={query.get("period") ?? ""}
      >
        <option value="">All dates</option>
        <option value="created">Created in period</option>
        <option value="resolved">Resolved in period</option>
        <option value="due_today">Due today</option>
        <option value="assigned_today">Assigned today</option>
        <option value="resolved_today">Resolved today</option>
      </SelectInput>
      <SelectInput
        name="attention"
        aria-label="Attention filter"
        defaultValue={query.get("attention") ?? ""}
      >
        <option value="">All attention states</option>
        {Object.keys(data.attention).map((k) => (
          <option key={k}>{k}</option>
        ))}
      </SelectInput>
      <Button type="submit" size="small" tone="secondary">
        Apply
      </Button>
      {query.size > 0 && (
        <ButtonLink size="small" href={pathname}>
          Reset
        </ButtonLink>
      )}
    </form>
  );
  const queueTable = (
    <Table
      headings={["Queue", "Open", "Overdue", "SLA risk"]}
      hasRows={data.queues.length > 0}
      empty="Create your first queue to organize incoming Cases."
    >
      {data.queues.map((q) => (
        <tr key={q.id}>
          <td className={cell}>
            <Link
              className="font-medium hover:text-blue-600"
              href={href("queues", { queue: q.id })}
            >
              {q.name}
            </Link>
            {!q.active && <span className="ml-2 text-muted">Inactive</span>}
          </td>
          <td className={cell}>{q.open_count}</td>
          <td className={cell}>{q.overdue_count}</td>
          <td className={cell}>
            <div className="flex items-center gap-2">
              <meter
                min={0}
                max={Math.max(q.open_count, 1)}
                value={q.overdue_count}
                aria-label={`${q.name} overdue proportion`}
                className="h-2 w-16"
              />
              <span>
                {q.open_count
                  ? Math.round((q.overdue_count / q.open_count) * 100)
                  : 0}
                %
              </span>
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
  const performance = (
    <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted">Latest resolution duration</p>
        <p className="mt-2 text-2xl font-semibold">
          {summary.resolution_hours === null
            ? "—"
            : `${Number(summary.resolution_hours).toFixed(1)}h`}
        </p>
        <p className="mt-1 text-xs text-muted">
          Creation to latest resolution; currently resolved or closed Cases in
          period.
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Resolution targets met</p>
        <p className="mt-2 text-2xl font-semibold">
          {summary.targeted_resolved
            ? `${Math.round((summary.met_target / summary.targeted_resolved) * 100)}%`
            : "—"}
        </p>
        <p className="mt-1 text-xs text-muted">
          {summary.met_target} of {summary.targeted_resolved} resolved Cases
          with a historical target.
        </p>
      </div>
    </div>
  );
  const timeline = (full = false) => (
    <div className="divide-y divide-border border-t border-border">
      {data.events.map((e) => (
        <div key={e.id} className="flex gap-3 px-4 py-3">
          <span
            className={`mt-1 size-2 shrink-0 rounded-full ${e.kind === "resolved" ? "bg-emerald-500" : e.kind === "escalated" ? "bg-rose-500" : "bg-blue-500"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap justify-between gap-1">
              <Link
                href={`${base}/cases/${e.case_id}`}
                className="text-xs font-semibold hover:text-blue-600"
              >
                {eventTitle(e)}{" "}
                <span className="font-normal text-muted">{e.case_number}</span>
              </Link>
              <time className="text-[10px] text-muted">
                {formatTime(e.occurred_at, timezone)}
              </time>
            </div>
            <p className="mt-1 text-xs text-muted">
              {e.actor_name}
              {eventChange(e) ? ` · ${eventChange(e)}` : ""}
            </p>
            {e.body && (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {e.body}
              </p>
            )}
          </div>
        </div>
      ))}
      {!data.events.length && <Empty>No Support activity yet.</Empty>}
      {full && (
        <div className="flex items-center justify-between gap-2 p-3 text-xs text-muted">
          <span>
            {data.event_total} events · page {query.get("event_page") ?? 1}
          </span>
          <div className="flex gap-2">
            <Button
              size="tiny"
              tone="secondary"
              disabled={Number(query.get("event_page") ?? 1) <= 1}
              onClick={() =>
                change({
                  event_page: String(Number(query.get("event_page") ?? 1) - 1),
                })
              }
            >
              Earlier page
            </Button>
            <Button
              size="tiny"
              tone="secondary"
              disabled={
                Number(query.get("event_page") ?? 1) * 25 >= data.event_total
              }
              onClick={() =>
                change({
                  event_page: String(Number(query.get("event_page") ?? 1) + 1),
                })
              }
            >
              Older events
            </Button>
          </div>
        </div>
      )}
    </div>
  );
  const inspector = c ? (
    <Panel title={view === "queues" ? "Selected Case" : "Case details"}>
      <div className="grid gap-4 border-t border-border p-4 text-xs">
        <Link
          href={`${base}/cases/${c.id}`}
          className="text-sm font-semibold text-blue-600"
        >
          {c.case_number} · {c.title}
        </Link>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3">
          <dt className="text-muted">Customer</dt>
          <dd>
            {c.customer_id ? (
              <Link
                className="text-blue-600"
                href={recordHref(organizationId, "customer", c.customer_id)}
              >
                {c.customer_name ?? "Customer"}
              </Link>
            ) : (
              "Internal request"
            )}
          </dd>
          <dt className="text-muted">Queue</dt>
          <dd>{c.queue_name ?? "No queue"}</dd>
          <dt className="text-muted">Owner</dt>
          <dd>
            {can("support.case.assign") &&
            !["resolved", "closed"].includes(c.status) ? (
              <QuickChange
                organizationId={organizationId}
                c={c}
                kind="owner"
                value={c.assigned_membership_id ?? ""}
                options={[
                  { value: "", label: "Unassigned" },
                  ...data.members.map((m) => ({ value: m.id, label: m.name })),
                ]}
              />
            ) : (
              (c.owner_name ?? "Unassigned")
            )}
          </dd>
          <dt className="text-muted">Priority</dt>
          <dd>
            <Badge value={c.priority} />
          </dd>
          <dt className="text-muted">Status</dt>
          <dd>
            <Badge value={c.status} />
          </dd>
          <dt className="text-muted">Created</dt>
          <dd>{formatTime(c.created_at, timezone)}</dd>
          <dt className="text-muted">SLA target</dt>
          <dd>{due(c)}</dd>
        </dl>
        {c.target_snapshot ? (
          <p className="rounded border border-blue-100 bg-blue-50/50 p-3 text-xs text-slate-600">
            {c.target_snapshot.name} · {c.target_snapshot.minutes} elapsed
            minutes. Applied on creation; retained after policy, priority and
            queue changes and reopening.
          </p>
        ) : (
          <p className="text-xs text-muted">
            No resolution policy applied when this Case was created.
          </p>
        )}
        {c.escalated_at && <Badge value="escalated" />}
        {view === "queues" && (
          <CaseActions
            organizationId={organizationId}
            c={c}
            data={data}
            can={can}
          />
        )}
      </div>
    </Panel>
  ) : null;
  return (
    <AppPage className={view === "home" ? "space-y-3" : "space-y-4"}>
      <PageLocation
        current={titles[view]}
        crumbs={view === "home" ? [] : [{ label: "Support", href: base }]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            className={`break-words font-semibold tracking-tight ${view === "home" ? "text-[30px] leading-9" : "text-2xl"}`}
          >
            {view === "detail"
              ? `${c?.case_number} · ${c?.title}`
              : titles[view]}
          </h1>
          {view === "home" && (
            <p className="mt-1 text-sm text-muted">
              Track customer issues, requests, queues, service levels, and
              resolution work.
            </p>
          )}
          {view === "detail" && c && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge value={c.status} />
              <Badge value={c.priority} />
              {c.escalated_at && <Badge value="escalated" />}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {can("support.case.create") && view !== "detail" && (
            <NewCase
              organizationId={organizationId}
              data={data}
              mayAssign={can("support.case.assign")}
            />
          )}{" "}
          {view === "home" && (
            <>
              <SupportViews href={href} />
              <ButtonLink
                className="h-9 rounded-md px-3 text-xs"
                href={`${base}/service-levels`}
              >
                <Settings className="size-4" />
                Configure
              </ButtonLink>
            </>
          )}
          {view === "queues" && can("support.configure") && (
            <ConfigurationEditor
              organizationId={organizationId}
              data={data}
              kind="queue"
            />
          )}
          {view === "policies" && can("support.configure") && (
            <ConfigurationEditor
              organizationId={organizationId}
              data={data}
              kind="policy"
            />
          )}
          {view === "detail" && c && (
            <CaseActions
              organizationId={organizationId}
              c={c}
              data={data}
              can={can}
            />
          )}
        </div>
      </header>
      {view !== "home" && (
        <nav
          aria-label="Support destinations"
          className="flex gap-1 overflow-x-auto border-b border-border text-xs"
        >
          {[
            ["", "Home"],
            ["cases", "Cases"],
            ["queues", "Queues"],
            ["service-levels", "Service levels"],
            ["reports", "Reports"],
          ].map(([path, label]) => (
            <Link
              key={path}
              href={href(path)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 ${titles[view] === label || (view === "policies" && path === "service-levels") || (view === "reports" && path === "reports") || (view === "detail" && path === "cases") ? "border-blue-600 font-semibold text-blue-600" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      {view !== "detail" && view !== "home" && (
        <form
          className="flex flex-wrap items-center justify-end gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            change({ from: String(f.get("from")), to: String(f.get("to")) });
          }}
        >
          <span className="text-muted">Reporting period · {timezone}</span>
          <TextInput
            className="w-auto"
            type="date"
            name="from"
            aria-label="From date"
            defaultValue={data.period.from}
          />
          <span>to</span>
          <TextInput
            className="w-auto"
            type="date"
            name="to"
            aria-label="To date"
            defaultValue={data.period.to}
          />
          <Button size="small" tone="secondary" type="submit">
            Set dates
          </Button>
        </form>
      )}
      {view === "reports" && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {kpis.map(([label, value, Icon, filters, color]) => (
            <Link
              key={label}
              href={href("cases", filters)}
              className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-background px-4 py-4 hover:border-blue-300"
            >
              <span
                className={`rounded-full p-2.5 ${color === "rose" ? "bg-rose-50 text-rose-600" : color === "amber" ? "bg-amber-50 text-amber-600" : color === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"}`}
              >
                <Icon className="size-5" />
              </span>
              <div>
                <div className="text-xl font-semibold">{value}</div>
                <div className="mt-1 text-xs text-muted">{label}</div>
                <div className="mt-2 text-[10px] text-muted">
                  {label === "Resolved Cases"
                    ? "Selected period"
                    : "Current backlog"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {view === "home" && (
        <SupportHome
          key={query.toString()}
          data={data}
          timezone={timezone}
          href={href}
          change={change}
          caseTable={caseTable}
        />
      )}
      {view === "cases" && (
        <Panel
          title={`${data.total} Cases`}
          action={
            <div className="flex gap-1">
              {["list", "board"].map((mode) => (
                <Button
                  key={mode}
                  size="tiny"
                  tone={
                    (query.get("view") ?? "list") === mode
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() => change({ view: mode })}
                >
                  {mode === "list" ? "List" : "Board"}
                </Button>
              ))}
            </div>
          }
        >
          {toolbar}
          {query.get("view") === "board" ? (
            <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-5">
              {data.board.map((column) => (
                <section
                  key={column.status}
                  className="min-w-0 rounded-md border border-border bg-surface/50"
                >
                  <div className="flex items-center justify-between border-b border-border p-3">
                    <Badge value={column.status} />
                    <strong className="text-xs">{column.count}</strong>
                  </div>
                  <div className="grid gap-2 p-2">
                    {column.cases.map((item) => (
                      <Link
                        key={item.id}
                        href={`${base}/cases/${item.id}`}
                        className="rounded-md border border-border bg-background p-3 text-xs hover:border-blue-300"
                      >
                        <span className="text-[10px] text-muted">
                          {item.case_number}
                        </span>
                        <p className="my-2 font-medium">{item.title}</p>
                        <Badge value={item.priority} />
                        <p className="mt-2 text-muted">
                          {item.owner_name ?? "Unassigned"}
                        </p>
                        <div className="mt-2">{due(item)}</div>
                      </Link>
                    ))}
                    {!column.count && (
                      <p className="p-3 text-xs text-muted">No Cases</p>
                    )}
                    <Button
                      size="tiny"
                      tone="secondary"
                      onClick={() =>
                        change({ status: column.status, view: "list" })
                      }
                    >
                      View all {column.count}
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <>
              {caseTable(data.cases)}
              {pagination(data.total)}
            </>
          )}
        </Panel>
      )}
      {view === "queues" && (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_280px]">
          <Panel title="Queue selection">
            <div className="divide-y divide-border border-t border-border">
              <Link
                href={href("queues")}
                className="flex justify-between p-3 text-xs"
              >
                All queues <strong>{summary.open}</strong>
              </Link>
              <Link
                href={href("queues", { queue: "none", status: "active" })}
                className="flex justify-between p-3 text-xs"
              >
                No queue <strong>{summary.unqueued}</strong>
              </Link>
              {data.queues.map((q) => (
                <div
                  key={q.id}
                  className={`p-3 ${query.get("queue") === q.id ? "bg-blue-50" : ""}`}
                >
                  <Link
                    href={href("queues", { queue: q.id, status: "active" })}
                    className="flex justify-between gap-2 text-xs font-medium"
                  >
                    <span>
                      {q.name}
                      {!q.active ? " (inactive)" : ""}
                    </span>
                    <strong>{q.open_count}</strong>
                  </Link>
                  <p className="my-2 text-[11px] text-muted">
                    {q.description || "No description"}
                  </p>
                  {can("support.configure") && (
                    <ConfigurationEditor
                      organizationId={organizationId}
                      data={data}
                      kind="queue"
                      queue={q}
                    />
                  )}
                </div>
              ))}
              {!data.queues.length && <Empty>No queues configured.</Empty>}
            </div>
          </Panel>
          <div className="min-w-0">
            <Panel
              title={
                data.queues.find((q) => q.id === query.get("queue"))?.name ??
                "Queue workbench"
              }
            >
              {toolbar}
              {caseTable(data.cases, true)}
              {pagination(data.total)}
            </Panel>
          </div>
          <div className="min-w-0 lg:col-start-2 xl:col-start-3">
            {inspector ?? (
              <Panel title="Case inspector">
                <Empty>
                  Select a Case to inspect its ownership and resolution target.
                </Empty>
              </Panel>
            )}
          </div>
        </div>
      )}
      {view === "detail" && c && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2.5fr)_minmax(260px,1fr)]">
          <main className="min-w-0 space-y-4">
            <Panel
              title="Problem description"
              action={
                can("support.case.update") &&
                !["resolved", "closed"].includes(c.status) ? (
                  <CaseDrawer
                    organizationId={organizationId}
                    c={c}
                    data={data}
                    kind="edit"
                    mayAssign={can("support.case.assign")}
                  />
                ) : null
              }
            >
              <p className="whitespace-pre-wrap break-words border-t border-border p-4 text-sm leading-6">
                {c.description || "No description recorded."}
              </p>
            </Panel>
            {c.resolution_summary && (
              <Panel title="Latest recorded resolution">
                <div className="border-t border-border p-4">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {c.resolution_summary}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {formatTime(c.resolved_at, timezone)} · Previous resolutions
                    remain in the timeline.
                  </p>
                </div>
              </Panel>
            )}
            <Panel title="Internal timeline">
              {!["resolved", "closed"].includes(c.status) &&
                can("support.case.update") && (
                  <InternalNote organizationId={organizationId} c={c} />
                )}{" "}
              {timeline(true)}
            </Panel>
          </main>
          <aside className="min-w-0 space-y-4">
            {inspector}
            <Panel
              title="Related records"
              action={
                can("support.case.update") &&
                !["resolved", "closed"].includes(c.status) ? (
                  <CaseDrawer
                    organizationId={organizationId}
                    c={c}
                    data={data}
                    kind="link"
                    mayAssign={false}
                  />
                ) : null
              }
            >
              <div className="divide-y divide-border border-t border-border">
                {data.links.map((l) => (
                  <div key={l.id} className="p-3">
                    <Link
                      className="text-xs text-blue-600 hover:underline"
                      href={
                        l.kind === "invoice" && l.invoice_work_item_id
                          ? `/organizations/${organizationId}/work/${l.invoice_work_item_id}?tab=financials`
                          : recordHref(organizationId, l.kind, l.record_id)
                      }
                    >
                      <span className="capitalize">
                        {l.kind.replaceAll("_", " ")}
                      </span>{" "}
                      · {l.label} · {l.record_id.slice(0, 8)}
                    </Link>
                  </div>
                ))}
                {!data.links.length && (
                  <Empty>No related records linked.</Empty>
                )}
              </div>
              {can("work_item.create") && (
                <div className="border-t border-border p-3">
                  <ButtonLink
                    size="small"
                    href={`/organizations/${organizationId}/work?create=1${c.customer_id ? `&customer=${c.customer_id}` : ""}`}
                  >
                    Create Work
                  </ButtonLink>
                </div>
              )}
            </Panel>
          </aside>
        </div>
      )}
      {view === "policies" && (
        <>
          <Panel title="Resolution policies">
            <Table
              headings={[
                "Policy",
                "Queue",
                "Priority",
                "Target",
                "Clock basis",
                "Active",
                "Actions",
              ]}
              hasRows={data.policies.length > 0}
              empty="No service levels configured. Cases without a matching policy have no SLA target."
            >
              {data.policies.map((p) => (
                <tr key={p.id}>
                  <td className={`${cell} font-medium`}>{p.name}</td>
                  <td className={cell}>
                    {data.queues.find((q) => q.id === p.queue_id)?.name ??
                      "All queues"}
                  </td>
                  <td className={cell}>
                    <Badge value={p.priority} />
                  </td>
                  <td className={cell}>{p.target_minutes} min</td>
                  <td className={cell}>Elapsed time</td>
                  <td className={cell}>
                    <Badge value={p.active ? "active" : "inactive"} />
                  </td>
                  <td className={cell}>
                    {can("support.configure") && (
                      <ConfigurationEditor
                        organizationId={organizationId}
                        data={data}
                        kind="policy"
                        policy={p}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
          <p className="text-xs text-muted">
            Queue-specific policies take precedence over the priority fallback.
            Targets apply on Case creation and retain their original snapshot
            after configuration changes, reassignment, priority changes and
            reopening. Business-hours clocks and first-response targets are
            unavailable.
          </p>
        </>
      )}
      {view === "reports" && (
        <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Panel title="Cases created and resolved by day">
              <div className="max-h-96 overflow-y-auto">
                <Table
                  headings={["Day", "Created", "Latest resolved", "Volume"]}
                  hasRows={data.trend.length > 0}
                  empty="No activity in this period."
                >
                  {data.trend.map((d) => (
                    <tr key={d.day}>
                      <td className={cell}>{d.day}</td>
                      <td className={cell}>
                        <Link
                          href={href("cases", {
                            from: d.day,
                            to: d.day,
                            period: "created",
                          })}
                        >
                          {d.created}
                        </Link>
                      </td>
                      <td className={cell}>
                        <Link
                          href={href("cases", {
                            from: d.day,
                            to: d.day,
                            period: "resolved",
                          })}
                        >
                          {d.resolved}
                        </Link>
                      </td>
                      <td className={cell}>
                        <meter
                          min={0}
                          max={Math.max(...data.trend.map((x) => x.created), 1)}
                          value={d.created}
                          aria-label={`${d.day} Cases created`}
                          className="h-3 w-24"
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Panel>
            <Panel title="Resolution performance">
              {performance}
              <div className="border-t border-border p-4 text-xs text-muted">
                Reopened Cases are excluded until resolved again. Duration
                includes elapsed time since initial creation through the latest
                resolution, including time spent previously resolved. SLA
                adherence includes only historically targeted Cases.
              </div>
            </Panel>
            <Panel title="Current queue backlog">{queueTable}</Panel>
            <Panel title="Case volume by queue">
              <Table
                headings={["Queue", "Created in period", "Latest resolved"]}
                hasRows
                empty="No queues configured."
              >
                {data.queues.map((q) => (
                  <tr key={q.id}>
                    <td className={cell}>
                      <Link href={href("queues", { queue: q.id })}>
                        {q.name}
                      </Link>
                    </td>
                    <td className={cell}>
                      <Link
                        href={href("cases", { queue: q.id, period: "created" })}
                      >
                        {q.created_count}
                      </Link>
                    </td>
                    <td className={cell}>
                      <Link
                        href={href("cases", {
                          queue: q.id,
                          period: "resolved",
                        })}
                      >
                        {q.resolved_count}
                      </Link>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className={cell}>
                    <Link href={href("queues", { queue: "none" })}>
                      No queue
                    </Link>
                  </td>
                  <td className={cell}>
                    <Link
                      href={href("cases", { queue: "none", period: "created" })}
                    >
                      {summary.unqueued_created}
                    </Link>
                  </td>
                  <td className={cell}>
                    <Link
                      href={href("cases", {
                        queue: "none",
                        period: "resolved",
                      })}
                    >
                      {summary.unqueued_resolved}
                    </Link>
                  </td>
                </tr>
              </Table>
            </Panel>
            <Panel title="Case volume by priority">
              <Table
                headings={["Priority", "Created in period", "All Cases"]}
                hasRows
                empty="No Cases."
              >
                {data.priorities.map((p) => (
                  <tr key={p.priority}>
                    <td className={cell}>
                      <Link href={href("cases", { priority: p.priority })}>
                        <Badge value={p.priority} />
                      </Link>
                    </td>
                    <td className={cell}>{p.created}</td>
                    <td className={cell}>{p.count}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </div>
          <p className="text-xs text-muted">
            Counts use exact tenant-wide queries. No customer satisfaction,
            presence, first-contact resolution or response-time estimates are
            inferred.
          </p>
        </>
      )}
    </AppPage>
  );
}

function RowActions({
  organizationId,
  c,
  data,
  can,
}: {
  organizationId: string;
  c: SupportCase;
  data: SupportData;
  can: (capability: string) => boolean;
}) {
  if (
    ![
      "support.case.update",
      "support.case.assign",
      "support.case.resolve",
    ].some(can)
  )
    return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="tiny"
          tone="secondary"
          aria-label={`Actions for ${c.case_number}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-3"
        onInteractOutside={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[role="dialog"]')
          )
            event.preventDefault();
        }}
      >
        <CaseActions
          organizationId={organizationId}
          c={c}
          data={data}
          can={can}
        />
      </PopoverContent>
    </Popover>
  );
}
function eventTitle(e: CaseEvent) {
  const labels: Record<string, string> = {
    created: "Case created",
    edited: "Details edited",
    status: "Status changed",
    priority: "Priority changed",
    assignment: "Assignment changed",
    queue: "Queue changed",
    escalated: "Case escalated",
    resolved: "Case resolved",
    reopened: "Case reopened",
    note: "Internal note",
    linked: "Record linked",
    unlinked: "Record unlinked",
    closed: "Case closed",
  };
  return labels[e.kind] ?? e.kind;
}
function eventChange(e: CaseEvent) {
  if (
    e.kind === "status" ||
    e.kind === "reopened" ||
    e.kind === "closed" ||
    e.kind === "resolved"
  )
    return `${e.previous_value?.status ?? "new"} → ${e.new_value.status}`;
  if (e.kind === "priority")
    return `${e.previous_value?.priority ?? "normal"} → ${e.new_value.priority}`;
  if (e.kind === "assignment")
    return `${e.previous_value?.owner_name ?? "Unassigned"} → ${e.new_value.owner_name ?? "Unassigned"}`;
  if (e.kind === "queue")
    return `${e.previous_value?.queue_name ?? "No queue"} → ${e.new_value.queue_name ?? "No queue"}`;
  return "";
}
