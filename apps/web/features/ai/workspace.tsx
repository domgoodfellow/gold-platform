"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  Boxes,
  Activity,
  TriangleAlert,
  Plus,
  Play,
} from "lucide-react";
import { AppPage } from "@/components/layout/app-page";
import { PageHeader } from "@/components/headers/page-header";
import { Button, ButtonLink } from "@/components/controls/button";
import { TextInput, TextArea } from "@/components/controls/inputs";
import {
  PageDrawer,
  PageDrawerTrigger,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerDescription,
  PageDrawerBody,
  PageDrawerFooter,
} from "@/components/panels/page-drawer";
import { useWorkspaceRail } from "@/components/panels/workspace-right-rail";
import type { AiWorkspaceData } from "@/lib/application/ai/workspace";
import {
  CHANNELS,
  configuration,
  TOOL_CATALOGUE,
  type Channel,
} from "@/lib/domain/ai/agents";
import { saveAgent } from "./actions";
import { AgentIcon, Badge, Field, cell } from "./ui";
import { MetricTile, OperationalPanel, PanelState } from "@/components/operational/primitives";
import { SelectField } from '@/components/controls/select-field';

export function NewAgent({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [pending, start] = useTransition();
  const router = useRouter();
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button disabled={!canManage}>
          <Plus size={15} />
          New agent
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>New agent</PageDrawerTitle>
          <PageDrawerDescription>
            Start with a draft. Publish a version before deploying.
          </PageDrawerDescription>
        </PageDrawerHeader>
        <form
          id="new-agent-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            start(async () => {
              const result = await saveAgent(organizationId, {
                id: null,
                name: String(form.get("name")),
                instructions: String(form.get("instructions")),
                configuration: {
                  description: String(form.get("description")),
                  purpose: String(form.get("purpose")),
                  policy: "read_only",
                  tools: [],
                },
                draft: null,
              });
              if (result.error) setError(result.error);
              else {
                setOpen(false);
                router.push(
                  `/organizations/${organizationId}/ai/agents/${result.id}`,
                );
              }
            });
          }}
        >
          <div className="space-y-5">
            <Field label="Name">
              <TextInput
                name="name"
                required
                maxLength={100}
                placeholder="Customer service agent"
              />
            </Field>
            <Field label="Description">
              <TextArea name="description" maxLength={1000} />
            </Field>
            <Field label="Purpose">
              <SelectField name="purpose" options={[...[
                  "General assistant",
                  "Customer service",
                  "Sales assistant",
                  "Support assistant",
                  "Scheduling assistant",
                  "Receptionist",
                ].map((p) => ({ value: p, label: p }))]} />
            </Field>
            <Field label="Starting instructions">
              <TextArea
                name="instructions"
                maxLength={8000}
                placeholder="Describe the work this agent should help with."
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        </form>
          <PageDrawerFooter>
            <Button
              type="button"
              tone="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="new-agent-form" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </Button>
          </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function AiWorkspace({
  organizationId,
  data,
  view = "",
  canManage,
  configure,
}: {
  organizationId: string;
  data: AiWorkspaceData;
  view?: string;
  canManage: boolean;
  configure?: ReactNode;
}) {
  const base = `/organizations/${organizationId}/ai`,
    router = useRouter(),
    search = useSearchParams();
  const [inspected, setInspected] = useState<string | null>(search.get("run"));
  const { agentOpen, toggleAgent } = useWorkspaceRail();
  function filter(key: string, value: string) {
    const params = new URLSearchParams(search);
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${base}${view ? `/${view}` : ""}?${params}`);
  }
  const title =
    (
      {
        agents: "Agents",
        deployments: "Channel deployments",
        knowledge: "Knowledge",
        tools: "Tools & permissions",
        activity: "Agent activity",
        evaluations: "Evaluations",
      } as Record<string, string>
    )[view] ?? "AI";
  const summary = data.summary;
  const selectedChannel = search.get("channel");
  const candidates = selectedChannel
    ? data.agents.filter((a) =>
        data.deployments.some(
          (d) => d.assistant_id === a.id && d.surface === selectedChannel,
        ),
      )
    : data.agents;
  const agents = view ? candidates : candidates.filter(a => a.status === "active");
  const visibleDeployments = data.deployments.filter(d => (!selectedChannel || d.surface === selectedChannel) &&
    (!(search.get("q") || search.get("status")) || data.agents.some(a => a.id === d.assistant_id)));
  const agentTable = (
    <OperationalPanel
      title={view === "agents" ? "Agents" : "Active agents"}
      action={
        <Link className="text-xs text-accent-text" href={`${base}/agents`}>
          View all
        </Link>
      }
    >
      <div className="divide-y divide-border sm:hidden">
        {agents.slice(0, view === "agents" ? 100 : 8).map((a) => (
          <Link key={a.id} href={`${base}/agents/${a.id}`} className="flex min-w-0 items-start gap-3 py-3">
            <AgentIcon />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{a.name}</strong>
              <span className="mt-1 block truncate text-xs text-muted">{configuration(a).description || "General assistant"}</span>
              <span className="mt-2 block text-xs text-muted">{data.deployments.filter(d => d.assistant_id === a.id).length} deployments · {configuration(a).tools?.length ?? 0} tools</span>
            </span>
            <Badge>{a.status}</Badge>
          </Link>
        ))}
        {!agents.length && <PanelState action={<NewAgent organizationId={organizationId} canManage={canManage} />}>No agents yet. Create a draft, test it, then publish a version to deploy it.</PanelState>}
      </div>
      <div className="hidden max-w-full overflow-x-auto sm:block">
        <table className="w-full min-w-[640px]">
          <thead className="bg-secondary text-muted">
            <tr>
              {[
                "Agent",
                "Status",
                "Channels",
                "Knowledge",
                "Tools",
                "Readiness",
              ].map((h) => (
                <th className={cell} key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.slice(0, view === "agents" ? 100 : 8).map((a) => {
              const ds = data.deployments.filter(
                (d) => d.assistant_id === a.id,
              );
              return (
                <tr
                  key={a.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/50"
                >
                  <td className={cell}>
                    <Link
                      href={`${base}/agents/${a.id}`}
                      className="flex gap-3"
                    >
                      <AgentIcon />
                      <span>
                        <strong className="block text-sm">{a.name}</strong>
                        <span className="mt-1 block max-w-60 truncate text-muted">
                          {configuration(a).description ||
                            configuration(a).purpose ||
                            "General assistant"}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className={cell}>
                    <Badge>{a.status}</Badge>
                  </td>
                  <td className={cell}>
                    <Link href={`${base}/agents/${a.id}?section=channels`}>
                      {ds
                        .map((d) => CHANNELS[d.surface as Channel])
                        .join(", ") || "No deployments"}
                    </Link>
                  </td>
                  <td className={cell}>
                    {
                      data.knowledge.filter((k) => k.assistant_id === a.id)
                        .length
                    }{" "}
                    sources
                  </td>
                  <td className={cell}>
                    {configuration(a).tools?.length ?? 0} tools
                  </td>
                  <td className={cell}>
                    {ds.length
                      ? `${ds.filter((d) => data.readiness.find((r) => r.id === d.id)?.state === "Enabled").length} enabled`
                      : "Not deployed"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!agents.length && (
          <PanelState>
            No agents yet. Create a draft to start configuring your first agent.
          </PanelState>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        {Math.min(agents.length, view === "agents" ? 100 : 8)} agents shown · bounded preview
      </p>
    </OperationalPanel>
  );
  const deploymentPanel = (
    <OperationalPanel
      title="Channel deployments"
      action={
        <Link href={`${base}/deployments`} className="text-xs text-accent-text">
          View all
        </Link>
      }
    >
      <div className="divide-y divide-border">
        {visibleDeployments
          .map((d) => (
            <Link
              key={d.id}
              href={`${base}/agents/${d.assistant_id}?section=channels&deployment=${d.id}`}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <strong className="block truncate text-sm">
                  {d.display_name}
                </strong>
                <span className="text-xs text-muted">
                  {CHANNELS[d.surface as Channel]} ·{" "}
                  {data.agents.find((a) => a.id === d.assistant_id)?.name ??
                    "Agent"}
                </span>
              </span>
              <Badge>
                {data.readiness.find((r) => r.id === d.id)?.state ??
                  "Unavailable"}
              </Badge>
            </Link>
          ))}
        {!visibleDeployments.length && <PanelState>No matching deployments. Configure a channel in the agent workbench.</PanelState>}
      </div>
    </OperationalPanel>
  );
  const activity = (
    <OperationalPanel
      title="Your recent agent interactions"
      action={
        <Link href={`${base}/activity`} className="text-xs text-accent-text">
          View all
        </Link>
      }
    >
      <div className="divide-y divide-border">
        {data.runs.map((r) => (
          <button
            key={r.id}
            className="flex w-full items-center justify-between gap-3 py-3 text-left"
            onClick={() => setInspected(r.id)}
          >
            <span className="min-w-0">
              <strong className="block truncate text-sm">{r.question}</strong>
              <span className="text-xs text-muted">
                {new Date(r.occurred_at).toLocaleString()}
              </span>
            </span>
            <Badge>{r.action_outcome ?? r.outcome}</Badge>
          </button>
        ))}
        {!data.runs.length && <PanelState>No operator runs in this period.</PanelState>}
      </div>
    </OperationalPanel>
  );
  const attention = (
    <OperationalPanel
      title="Needs attention"
      action={
        <Link
          className="text-xs text-accent-text"
          href={`${base}/activity?outcome=failed`}
        >
          Review activity
        </Link>
      }
    >
      <div className="divide-y divide-border">
        {data.readiness
          .filter((r) => r.state === "Unavailable")
          .slice(0, 3)
          .map((r) => {
            const d = data.deployments.find((d) => d.id === r.id)!;
            return (
              <Link
                key={r.id}
                className="flex gap-3 py-3 first:pt-0"
                href={`${base}/agents/${d.assistant_id}?section=channels&deployment=${d.id}`}
              >
                <TriangleAlert
                  size={17}
                  className="mt-1 shrink-0 text-warning"
                />
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{d.display_name}</strong>
                  <span title={r.reason} className="mt-1 block truncate text-xs text-muted">
                    {r.reason}
                  </span>
                </span>
              </Link>
            );
          })}
        {summary.handoffs > 0 && (
          <Link
            className="block py-3 text-sm text-accent-text"
            href={`/organizations/${organizationId}/comms/inbox/website`}
          >
            {summary.handoffs} handoffs in Communications →
          </Link>
        )}
        {summary.approvals > 0 && (
          <button
            className="py-3 text-sm text-accent-text"
            onClick={() => {
              if (!agentOpen) toggleAgent();
            }}
          >
            {summary.approvals} approvals in your Agent rail →
          </button>
        )}
        {!data.readiness.some((r) => r.state === "Unavailable") &&
          !summary.handoffs &&
          !summary.approvals && (
            <PanelState>No recorded issues requiring attention.</PanelState>
          )}
      </div>
    </OperationalPanel>
  );
  return (
    <AppPage className="space-y-4">
      <PageHeader
        title={title}
        actions={<>
          {(!view || view === "activity") && <SelectField aria-label="Date range" value={String(data.days)} onValueChange={(next) => filter("days", next)} options={[{ value: '30', label: 'Last 30 days' }, { value: '7', label: 'Last 7 days' }]} />}
          <NewAgent organizationId={organizationId} canManage={canManage} />
          {canManage ? <ButtonLink tone="secondary" href={`${base}/agents`}>
            <Play aria-hidden />
            Test agent
          </ButtonLink> : null}
          {configure}
        </>}
      />
      {!view && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: "Active agents",
              value: summary.agents,
              icon: Bot,
              href: "/agents?status=active",
              hint: "Published and active",
            },
            {
              label: "Enabled deployments",
              value: summary.deployments,
              icon: Boxes,
              href: "/deployments",
              hint: "Enabled is not verified operational",
            },
            {
              label: "Your operator interactions",
              value: summary.operatorInteractions,
              icon: Activity,
              href: "/activity",
              hint: `Last ${data.days} days · your runs only`,
            },
            {
              label: "Your failed interactions",
              value: summary.failures,
              icon: TriangleAlert,
              href: "/activity?outcome=failed",
              hint: `Last ${data.days} days`,
            },
          ].map((k) => (
            <MetricTile key={k.label} label={k.label} value={k.value} detail={k.hint} icon={k.icon} href={`${base}${k.href}`} />
          ))}
        </div>
      )}
      {["", "agents", "deployments", "activity"].includes(view) && <form
        className="flex flex-wrap gap-2"
              >
        <SelectField aria-label="Status" value={search.get(view === "activity" ? "outcome" : "status") ?? ""} onValueChange={(next) => filter(view === "activity" ? "outcome" : "status", next)} options={[{ value: '', label: 'All statuses' }, ...(view === "activity" ? ["answered", "unanswered", "failed"] : ["draft", "active", "disabled"]).map((s) => ({ value: s, label: s }))]} />
        {view !== "activity" && <SelectField aria-label="Channel" value={selectedChannel ?? ""} onValueChange={(next) => filter("channel", next)} options={[{ value: '', label: 'All channels' }, ...Object.entries(CHANNELS).map(([key, label]) => ({ value: key, label: label }))]} />}
        
      </form>}
      {!view ? (
        <>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(260px,1fr)]">
            <div className="min-w-0 space-y-4">
              {agentTable}
              {deploymentPanel}
              {activity}
              <OperationalPanel title="Performance">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted">Answered operator runs</dt>
                    <dd>
                      {data.runs.filter((r) => r.outcome === "answered").length}{" "}
                      in this preview
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Evaluation results</dt>
                    <dd>
                      {
                        data.evaluations.filter((e) => e.verdict === "passed")
                          .length
                      }{" "}
                      passed /{" "}
                      {
                        data.evaluations.filter((e) => e.verdict === "failed")
                          .length
                      }{" "}
                      failed in your recent evaluations
                    </dd>
                  </div>
                </dl>
              </OperationalPanel>
            </div>
            <aside className="min-w-0 space-y-4">
              {attention}
              <OperationalPanel title="Agent readiness">
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt>Agent entitlement</dt>
                    <dd>
                      <Badge>
                        {data.entitled ? "Available" : "Not available"}
                      </Badge>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Operator interface</dt>
                    <dd>
                      <button
                        className="text-accent-text"
                        onClick={() => {
                          if (!agentOpen) toggleAgent();
                        }}
                      >
                        Open Agent ↗
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Provider health</dt>
                    <dd className="mt-1 text-xs text-muted">
                      Not measured here. A successful integration test is
                      required to establish channel operation.
                    </dd>
                  </div>
                </dl>
              </OperationalPanel>
              <OperationalPanel title="Approvals & handoffs">
                <p className="text-sm">
                  {summary.approvals} pending approvals in your conversations
                </p>
                <p className="mt-2 text-sm">
                  {summary.handoffs} website handoffs requested
                </p>
                <Link
                  className="mt-3 inline-block text-xs text-accent-text"
                  href={`/organizations/${organizationId}/comms/inbox/website`}
                >
                  Open Communications →
                </Link>
              </OperationalPanel>
              <OperationalPanel title="Usage & allowance">
                {data.usage.items.length ? <dl className="space-y-3 text-sm">{data.usage.items.map(item => <div key={item.allowanceKey}><dt className="font-medium">{item.label}</dt><dd className="mt-1 text-xs text-muted">{item.consumed ?? 'Unmeasured'} / {item.included ?? 'Unspecified'} {item.unit} · {item.period}</dd></div>)}</dl> : <p className="text-xl font-semibold">Unavailable</p>}
                <p className="mt-2 text-xs text-muted">
                  Missing measurements are not zero usage.
                </p>
                <Link
                  className="mt-3 inline-block text-xs text-accent-text"
                  href={`/organizations/${organizationId}/settings/plan`}
                >
                  Plan & usage →
                </Link>
              </OperationalPanel>
              <OperationalPanel title="Recent failures">
                {data.runs
                  .filter((r) => r.outcome === "failed")
                  .slice(0, 3)
                  .map((r) => (
                    <button
                      key={r.id}
                      className="block w-full truncate py-2 text-left text-xs"
                      onClick={() => setInspected(r.id)}
                    >
                      {r.detail || "Interaction failed"}
                    </button>
                  ))}
                {!data.runs.some((r) => r.outcome === "failed") && (
                  <PanelState>No failures in your recent runs.</PanelState>
                )}
              </OperationalPanel>
            </aside>
          </div>
        </>
      ) : null}
      {view === "agents" && agentTable}
      {view === "deployments" && deploymentPanel}
      {view === "activity" && (
        <>
          {activity}
          <OperationalPanel title="Public conversations">
            {data.threads.map((t) => (
              <Link
                key={t.id}
                className="flex justify-between gap-3 border-b border-border py-3 text-sm"
                href={`/organizations/${organizationId}/comms/inbox/website?thread=${t.id}`}
              >
                <span>
                  {t.channel} · {t.id.slice(0, 8)}
                </span>
                <Badge>{t.state}</Badge>
              </Link>
            ))}
            {!data.threads.length && (
              <PanelState>No public conversations recorded.</PanelState>
            )}
          </OperationalPanel>
        </>
      )}
      {view === "knowledge" && (
        <OperationalPanel title="Published website knowledge">
          {data.sites
            .filter((s) => s.current_published_revision_id)
            .map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between border-b border-border py-3 text-sm"
              >
                <span>{`Website ${s.id.slice(0, 8)}`}</span>
                <Badge>Published</Badge>
              </div>
            ))}
          {!data.sites.some((s) => s.current_published_revision_id) && (
            <PanelState>No published websites available.</PanelState>
          )}
          <ButtonLink tone="secondary" href={`${base}/agents`}>
            Choose an agent
          </ButtonLink>
        </OperationalPanel>
      )}
      {view === "tools" && (
        <OperationalPanel title="Governed tool catalogue">
          <div className="divide-y divide-border">
            {TOOL_CATALOGUE.map((t) => (
              <div
                key={t.key}
                className="grid gap-2 py-4 sm:grid-cols-[1fr_2fr_auto]"
              >
                <div>
                  <strong className="text-sm">{t.name}</strong>
                  <p className="text-xs text-muted">{t.owner}</p>
                </div>
                <p className="text-sm text-muted">{t.description}</p>
                <Badge>Read · caller authorized</Badge>
              </div>
            ))}
            <div className="py-4">
              <strong className="text-sm">Propose Work reschedule</strong>
              <p className="mt-1 text-xs text-muted">
                Proposed action only. A human approves in the global Agent rail;
                canonical Work authorization runs again at execution.
              </p>
            </div>
            <div className="py-4">
              <strong className="text-sm">External & MCP tools</strong>
              <p className="mt-1 text-xs text-muted">
                No approved execution transport is available. Existing
                Connection grants do not grant arbitrary tool execution.
              </p>
            </div>
          </div>
        </OperationalPanel>
      )}
      {view === "evaluations" && (
        <OperationalPanel title="Your recent evaluations">
          {data.evaluations.map((e) => (
            <Link
              key={e.id}
              href={`${base}/agents/${e.assistant_id}?section=testing`}
              className="flex justify-between gap-3 border-b border-border py-3 text-sm"
            >
              <span className="min-w-0 truncate">{e.scenario}</span>
              <Badge>{e.verdict ?? "Awaiting assessment"}</Badge>
            </Link>
          ))}
          {!data.evaluations.length && (
            <PanelState>Run a safe preview from an agent’s Testing section.</PanelState>
          )}
        </OperationalPanel>
      )}
      <PageDrawer
        open={Boolean(inspected)}
        onOpenChange={(open) => {
          if (!open) setInspected(null);
        }}
      >
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle>Execution inspector</PageDrawerTitle>
            <PageDrawerDescription>
              Your recorded operator interaction.
            </PageDrawerDescription>
          </PageDrawerHeader>
          <PageDrawerBody>
            {!data.runs.some(r => r.id === inspected) && <PanelState kind="restricted">This interaction is outside the current filter or is unavailable to you.</PanelState>}
            {data.runs
              .filter((r) => r.id === inspected)
              .map((r) => (
                <div key={r.id} className="space-y-5 text-sm">
                  <Badge>{r.outcome}</Badge>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <dt className="text-muted">Agent / version</dt>
                    <dd>{r.assistant_version_id ? (() => { const version = data.versions.find(v => v.id === r.assistant_version_id); return version ? `${version.name} · v${version.version_number}` : r.assistant_version_id; })() : "Built-in / legacy attribution"}</dd>
                    <dt className="text-muted">Deployment</dt>
                    <dd>{data.deployments.find(d => d.id === r.assistant_deployment_id)?.display_name ?? "Operator default"}</dd>
                  </dl>
                  <p>{r.question}</p>
                  <p className="whitespace-pre-wrap">
                    {r.answer || r.detail || "No answer recorded."}
                  </p>
                  <div>
                    <h3 className="font-medium">Tool evidence</h3>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(r.tools, null, 2)}
                    </pre>
                  </div>
                  {r.proposed_action && (
                    <div>
                      <h3 className="font-medium">Proposed action</h3>
                      <pre className="overflow-auto whitespace-pre-wrap text-xs">
                        {JSON.stringify(r.proposed_action, null, 2)}
                      </pre>
                      <Badge>{r.action_outcome ?? "Not executed"}</Badge>
                      {r.action_detail && <p className="mt-2 text-xs text-muted">{r.action_detail}</p>}
                    </div>
                  )}
                  <p className="text-xs text-muted">
                    {r.answered_by} · {new Date(r.occurred_at).toLocaleString()}
                  </p>
                </div>
              ))}
          </PageDrawerBody>
        </PageDrawerContent>
      </PageDrawer>
    </AppPage>
  );
}
