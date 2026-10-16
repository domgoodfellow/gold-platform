"use client";

import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { NavigationList } from '@/components/navigation/navigation-list';
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChartNoAxesCombined,
  Check,
  CircleCheck,
  ClipboardList,
  Clock,
  Headset,
  Layers,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@gold/ui/components/popover";
import { Button, ButtonLink } from "@/components/controls/button";
import {
  ActivityList,
  FilterMenu,
  MetricTile,
  OperationalPanel,
  RelativeTime,
  ResourceTile,
  RiskBar,
  type StatusTone,
} from "@/components/operational/primitives";
import {
  PRIORITIES,
  STATUSES,
  type SupportCase,
  type SupportData,
} from "@/lib/domain/support/support";

export function SupportViews({
  href,
}: {
  href: (path: string, filters?: Record<string, string>) => string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button tone="secondary" className="h-9 gap-2 rounded-md px-3 text-xs">
          <Layers className="size-4" />
          Views
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <NavigationList label="Support destinations" density="compact" items={[
          ['', 'Overview'], ['cases', 'All Cases'], ['cases?view=board', 'Status board'],
          ['queues', 'Queue workbench'], ['service-levels', 'Service levels'], ['reports', 'Support reports'],
        ].map(([path, title]) => ({ key: path, title, href: path.includes('?') ? href('cases', { view: 'board' }) : href(path) }))} />
      </PopoverContent>
    </Popover>
  );
}

export function SupportHome({
  data,
  timezone,
  href,
  change,
  caseTable,
}: {
  data: SupportData;
  timezone: string;
  href: (path: string, filters?: Record<string, string>) => string;
  change: (values: Record<string, string>) => void;
  caseTable: (items: SupportCase[]) => ReactNode;
}) {
  const query = useSearchParams();
  const summary = data.summary;
  const [dismissed, setDismissed] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>(() => ({
    queue: query.get("queue") ?? "",
    priority: query.get("priority") ?? "",
    status: query.get("status") ?? "",
    owner: query.get("owner") ?? "",
    sort: query.get("sort") ?? "",
    period: query.get("period") ?? "",
  }));
  const setFilter = (key: string) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    change({ [key]: value });
  };
  const attention = [
    ...new Map(
      [
        ...data.attention.overdue,
        ...data.attention.urgent,
        ...data.attention.escalated,
        ...data.attention.unassigned,
      ].map((c) => [c.id, c]),
    ).values(),
  ].slice(0, 4);
  const metrics: {
    label: string;
    value: number;
    detail: string;
    icon: typeof ClipboardList;
    emphasis?: "warning" | "danger";
    filters: Record<string, string>;
  }[] = [
    {
      label: "Open cases",
      value: summary.open,
      detail: `${summary.urgent} urgent · ${summary.due_today} due today`,
      icon: ClipboardList,
      filters: { status: "active" },
    },
    {
      label: "Unassigned cases",
      value: summary.unassigned,
      detail: "Awaiting an owner",
      icon: Users,
      emphasis: summary.unassigned > 0 ? "warning" : undefined,
      filters: { attention: "unassigned" },
    },
    {
      label: "Overdue Cases",
      value: summary.overdue,
      detail: `${summary.near_due} due within 4 hours`,
      icon: TriangleAlert,
      emphasis: summary.overdue > 0 ? "danger" : undefined,
      filters: { attention: "overdue" },
    },
    {
      label: "Resolved cases",
      value: summary.resolved,
      detail: "In selected reporting period",
      icon: CircleCheck,
      filters: { period: "resolved" },
    },
  ];
  const tabs: {
    label: string;
    count?: number;
    filters: Record<string, string>;
    selected: boolean;
  }[] = [
    {
      label: "All",
      count: summary.open,
      filters: { attention: "", status: "" },
      selected: !query.get("attention") && !query.get("status"),
    },
    {
      label: "Unassigned",
      count: summary.unassigned,
      filters: { attention: "unassigned", status: "" },
      selected: query.get("attention") === "unassigned",
    },
    {
      label: "Overdue",
      count: summary.overdue,
      filters: { attention: "overdue", status: "" },
      selected: query.get("attention") === "overdue",
    },
    {
      label: "Escalated",
      filters: { attention: "escalated", status: "" },
      selected: query.get("attention") === "escalated",
    },
    {
      label: "Waiting",
      filters: { attention: "", status: "waiting" },
      selected: query.get("status") === "waiting",
    },
  ];
  const activeCases = data.cases.filter((c) =>
    ["new", "open", "waiting"].includes(c.status),
  );
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {metrics.map((m) => (
            <MetricTile key={m.label} {...m} href={href("cases", m.filters)} />
          ))}
        </div>
        {summary.overdue > 0 && !dismissed && (
          <div className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-3.5 py-2.5">
            <TriangleAlert className="size-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground">
                {summary.overdue} cases have breached SLA
              </p>
              <p className="mt-0.5 text-xs text-muted">
                These cases are past their resolution target.
              </p>
            </div>
            <ButtonLink
              size="small"
              href={href("cases", { attention: "overdue" })}
              className="h-8 shrink-0 border-danger/30 bg-danger/10 text-xs text-danger"
            >
              Review now
            </ButtonLink>
            <Button
              tone="text"
              size="tiny"
              aria-label="Dismiss SLA alert"
              onClick={() => setDismissed(true)}
            >
              <X className="size-3.5 text-muted" />
            </Button>
          </div>
        )}
        <section
          aria-label="Case workbench"
          className="min-w-0 overflow-hidden rounded-md border border-border bg-background"
        >
          <h2 className="sr-only">Active Cases</h2>
          <div
            role="group" data-slot="tabs-list" data-variant="segmented"
            className={tabListStyles()}
            aria-label="Case views"
          >
            {tabs.map((tab) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => change(tab.filters)}
                aria-pressed={tab.selected}
                data-slot="tabs-trigger"
                className={tabTriggerStyles}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="ml-1">({tab.count})</span>
                )}
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2.5"
            onSubmit={(e) => e.preventDefault()}
          >
            <FilterMenu
              label="Queue"
              name="queue"
              value={filters.queue}
              onValueChange={setFilter("queue")}
              options={[
                { value: "", label: "Queue" },
                { value: "none", label: "No queue" },
                ...data.queues.map((q) => ({ value: q.id, label: q.name })),
              ]}
            />
            <FilterMenu
              label="Priority"
              name="priority"
              value={filters.priority}
              onValueChange={setFilter("priority")}
              options={[
                { value: "", label: "Priority" },
                ...PRIORITIES.map((p) => ({
                  value: p,
                  label: p[0].toUpperCase() + p.slice(1),
                })),
              ]}
            />
            <FilterMenu
              label="Status"
              name="status"
              value={filters.status}
              onValueChange={setFilter("status")}
              options={[
                { value: "", label: "Status" },
                ...STATUSES.filter((s) =>
                  ["new", "open", "waiting"].includes(s),
                ).map((s) => ({
                  value: s,
                  label: s[0].toUpperCase() + s.slice(1),
                })),
              ]}
            />
            <FilterMenu
              label="Owner"
              name="owner"
              value={filters.owner}
              onValueChange={setFilter("owner")}
              options={[
                { value: "", label: "Owner" },
                { value: "unassigned", label: "Unassigned" },
                ...data.members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  tone="secondary"
                  className="size-9 rounded-md p-0"
                  aria-label="More case filters"
                >
                  <SlidersHorizontal className="size-4 text-muted" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3 p-3">
                <p className="text-xs font-semibold">More filters</p>
                <FilterMenu
                  label="Sort cases"
                  value={filters.sort}
                  onValueChange={setFilter("sort")}
                  options={[
                    { value: "", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "due", label: "SLA target" },
                  ]}
                />
                <Button
                  type="button"
                  tone="text"
                  size="small"
                  onClick={() =>
                    change({
                      q: "",
                      queue: "",
                      priority: "",
                      status: "",
                      owner: "",
                      attention: "",
                      sort: "",
                      period: "",
                    })
                  }
                >
                  Reset filters
                </Button>
              </PopoverContent>
            </Popover>
            <button type="submit" className="sr-only">
              Search cases
            </button>
          </form>
          {caseTable(activeCases)}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted">
            <span>
              Showing {activeCases.length} of {data.total} matching cases
            </span>
            <Link
              href={href("cases", Object.fromEntries(query))}
              className="font-medium text-accent-text hover:underline"
            >
              View all cases →
            </Link>
          </div>
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          <OperationalPanel
            title="Resolution performance"
            href={href("reports")}
          >
            <div className="grid grid-cols-2 gap-3 border-t border-border px-3.5 py-3">
              <div>
                <p className="text-[11px] text-muted">
                  Latest resolution duration
                </p>
                <p className="mt-1 text-xl font-semibold tracking-tight">
                  {summary.resolution_hours === null
                    ? "—"
                    : `${Number(summary.resolution_hours).toFixed(1)}h`}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  Creation to latest resolution
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted">
                  Resolution targets met
                </p>
                <p className="mt-1 text-xl font-semibold tracking-tight">
                  {summary.targeted_resolved
                    ? `${Math.round((summary.met_target / summary.targeted_resolved) * 100)}%`
                    : "—"}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  {summary.met_target} of {summary.targeted_resolved} targeted
                  cases
                </p>
              </div>
            </div>
          </OperationalPanel>
          <OperationalPanel
            title="Today"
            href={href("cases", { period: "due_today" })}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-3.5 py-3">
              {[
                ["Due today", summary.due_today, { period: "due_today" }],
                [
                  "Newly assigned",
                  summary.assigned_today,
                  { period: "assigned_today" },
                ],
                [
                  "Resolved today",
                  summary.resolved_today,
                  { period: "resolved_today" },
                ],
                [
                  "Due within 4 hours",
                  summary.near_due,
                  { sort: "due", status: "active" },
                ],
              ].map(([label, value, f]) => (
                <Link
                  key={String(label)}
                  href={href("cases", f as Record<string, string>)}
                  className="flex justify-between gap-2 text-xs text-muted"
                >
                  <span>{String(label)}</span>
                  <strong className="font-semibold text-foreground">
                    {String(value)}
                  </strong>
                </Link>
              ))}
            </div>
          </OperationalPanel>
        </div>
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-tight">
            Support tools & resources
          </h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <ResourceTile
              href={href("cases")}
              title="Cases"
              description="View and manage support cases"
              icon={ClipboardList}
            />
            <ResourceTile
              href={href("queues")}
              title="Queues"
              description="Organize team responsibility"
              icon={Layers}
            />
            <ResourceTile
              href={href("service-levels")}
              title="Service levels"
              description="Manage resolution targets"
              icon={Clock}
            />
            <ResourceTile
              href={href("reports")}
              title="Reports"
              description="Support performance and insights"
              icon={ChartNoAxesCombined}
            />
          </div>
        </section>
      </div>
      <aside className="min-w-0 space-y-3">
        <OperationalPanel
          title="Needs attention"
          count={summary.overdue}
          href={href("cases", {
            attention: summary.overdue ? "overdue" : "urgent",
          })}
        >
          <div className="divide-y divide-border px-3.5">
            {attention.map((c) => {
              const overdue = data.attention.overdue.some(
                (item) => item.id === c.id,
              );
              return (
                <div key={c.id} className="flex items-center gap-2.5 py-2.5">
                  {overdue ? (
                    <TriangleAlert className="size-[18px] shrink-0 text-danger" />
                  ) : (
                    <Clock className="size-[18px] shrink-0 text-warning" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={href(`cases/${c.id}`)}
                      className="block truncate text-xs hover:text-accent-text"
                    >
                      <strong className="font-semibold">{c.case_number}</strong>
                      <span className="ml-1.5">{c.title}</span>
                    </Link>
                    <p className="mt-1 truncate text-[11px] text-muted">
                      {c.customer_name ?? "Internal request"} ·{" "}
                      <RelativeTime
                        value={c.resolution_due_at}
                        deadline
                        timezone={timezone}
                      />
                    </p>
                  </div>
                  <ButtonLink
                    size="tiny"
                    href={href(`cases/${c.id}`)}
                    className={`h-7 border-0 px-2.5 text-[11px] shadow-none ${overdue ? "bg-danger/10 text-danger hover:bg-danger/20" : "bg-selected text-accent-text hover:bg-hover"}`}
                  >
                    {overdue ? "Review" : "View"}
                  </ButtonLink>
                </div>
              );
            })}
            {!attention.length && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-xs text-muted">
                <CircleCheck className="size-6 text-success" />
                No cases need attention.
              </div>
            )}
          </div>
        </OperationalPanel>
        <OperationalPanel title="Queue health" href={href("queues")}>
          <div className="px-3.5 pb-2">
            <div className="grid grid-cols-[minmax(0,1fr)_32px_110px] gap-2 rounded bg-secondary px-1 py-2 text-[10px] text-muted">
              <span>Queue</span>
              <span>Open</span>
              <span>SLA risk</span>
            </div>
            {data.queues.map((q) => (
              <Link
                key={q.id}
                href={href("queues", { queue: q.id })}
                className="grid grid-cols-[minmax(0,1fr)_32px_110px] items-center gap-2 border-b border-border py-2.5 text-[11px] last:border-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Headset className="size-3.5 shrink-0 text-accent-text" />
                  <span className="truncate">{q.name}</span>
                </span>
                <strong className="font-semibold">{q.open_count}</strong>
                <RiskBar
                  label={`${q.name} overdue proportion`}
                  value={
                    q.open_count ? (q.overdue_count / q.open_count) * 100 : 0
                  }
                />
              </Link>
            ))}
            {!data.queues.length && (
              <div className="py-5 text-center text-xs text-muted">
                No queues configured.
              </div>
            )}
          </div>
        </OperationalPanel>
        <OperationalPanel title="Recent activity" href={href("cases")}>
          <ActivityList
            items={data.events.slice(0, 5).map((e) => ({
              id: e.id,
              title: (
                <>
                  {(
                    {
                      created: "New case",
                      resolved: "Case resolved",
                      reopened: "Case reopened",
                      note: "Internal note",
                      escalated: "Case escalated",
                      status: "Status changed",
                      assignment: "Owner changed",
                      queue: "Queue changed",
                      priority: "Priority changed",
                      edited: "Details edited",
                      linked: "Record linked",
                      unlinked: "Record unlinked",
                      closed: "Case closed",
                    } as Record<string, string>
                  )[e.kind] ?? e.kind}
                  <span className="ml-1.5 font-normal text-muted">
                    {e.case_number}
                  </span>
                </>
              ),
              description: e.body || `${e.actor_name} · ${e.title}`,
              time: <RelativeTime value={e.occurred_at} timezone={timezone} />,
              tone: (
                e.kind === "resolved"
                  ? "success"
                  : e.kind === "escalated"
                    ? "danger"
                    : "neutral"
              ) satisfies StatusTone,
              href: href(`cases/${e.case_id}`),
            }))}
          />
          {!data.events.length && (
            <p className="px-3.5 pb-5 text-xs text-muted">
              No Support activity yet.
            </p>
          )}
        </OperationalPanel>
        <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
          <Check className="size-3.5 text-success" />
          {data.policies.filter((p) => p.active).length} active resolution
          policies
          <Link href={href("service-levels")} className="ml-auto text-accent-text">
            Manage
          </Link>
        </div>
      </aside>
    </div>
  );
}
