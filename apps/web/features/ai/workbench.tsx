"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Save, Play, Plus, Globe, ShieldCheck } from "lucide-react";
import { AppPage } from "@/components/layout/app-page";
import { Button, ButtonLink } from "@/components/controls/button";
import { TextInput, TextArea } from "@/components/controls/inputs";
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerDescription,
  PageDrawerBody,
  PageDrawerFooter,
} from "@/components/panels/page-drawer";
import { useWorkspaceRail } from "@/components/panels/workspace-right-rail";
import { PublicCommunicationWidget } from "@/features/communications/public-widget";
import {
  CHANNELS,
  TOOL_CATALOGUE,
  configuration,
  type Agent,
  type AgentConfiguration,
  type Deployment,
  type Evaluation,
  type Channel,
} from "@/lib/domain/ai/agents";
import type { AiWorkspaceData } from "@/lib/application/ai/workspace";
import {
  saveAgent,
  publishAgent,
  setKnowledge,
  saveDeployment,
  testAgent,
  evaluateResult,
  deleteAgent,
  deleteDeployment,
} from "./actions";
import { AgentIcon, Badge, Field } from "./ui";
import { OperationalPanel, PanelState } from "@/components/operational/primitives";
import { SelectField } from '@/components/controls/select-field';

const SECTIONS = [
  "overview",
  "instructions",
  "channels",
  "knowledge",
  "tools",
  "handoff",
  "testing",
  "activity",
  "versions",
] as const;
const LABELS: Record<string, string> = {
  overview: "Overview",
  instructions: "Instructions",
  channels: "Channels",
  knowledge: "Knowledge",
  tools: "Tools & permissions",
  handoff: "Handoff",
  testing: "Testing",
  activity: "Activity",
  versions: "Versions",
};

export function AgentWorkbench({
  organizationId,
  agent,
  data,
  canManage,
  userId,
  connectedTools = [],
}: {
  organizationId: string;
  agent: Agent;
  data: AiWorkspaceData;
  canManage: boolean;
  userId: string;
  /** What this agent has been given through Connections, read-only here. */
  connectedTools?: { id: string; label: string; source: string; needsApproval: boolean }[];
}) {
  const router = useRouter(),
    params = useSearchParams(),
    base = `/organizations/${organizationId}/ai`;
  const initialSection = params.get("section") ?? "overview";
  const [section, setSection] = useState<string>(
    SECTIONS.includes(initialSection as (typeof SECTIONS)[number])
      ? initialSection
      : "overview",
  );
  const [name, setName] = useState(agent.name),
    [instructions, setInstructions] = useState(agent.instructions),
    [config, setConfig] = useState<AgentConfiguration>(configuration(agent));
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, start] = useTransition();
  const [deployment, setDeployment] = useState<Deployment | null>(
      data.deployments.find((d) => d.id === params.get("deployment")) ?? null,
    ),
    [channelOpen, setChannelOpen] = useState(Boolean(params.get("deployment")));
  const [versionInspected, setVersionInspected] = useState<string | null>(null);
  const versions = data.versions.filter((v) => v.assistant_id === agent.id),
    deployments = data.deployments.filter((d) => d.assistant_id === agent.id);
  const { agentOpen, toggleAgent } = useWorkspaceRail();
  const draftBase = useRef(agent.draft_number);
  const recoveryReady = useRef(false);
  const recoveryKey = `gold.ai-draft.${userId}.${organizationId}.${agent.id}`;
  useEffect(() => {
    let active = true;
    let saved: { name: string; instructions: string; configuration: AgentConfiguration; draft: number } | null = null;
    try {
      const raw = sessionStorage.getItem(recoveryKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.name === "string" && typeof parsed.instructions === "string" && Number.isInteger(parsed.draft) && parsed.configuration && typeof parsed.configuration === "object") saved = parsed;
      }
    } catch { /* Recovery is optional when browser storage is unavailable. */ }
    queueMicrotask(() => {
      if (!active) return;
      recoveryReady.current = true;
      if (saved) {
        draftBase.current = saved.draft;
        setName(saved.name);
        setInstructions(saved.instructions);
        setConfig(saved.configuration);
        setDirty(true);
        setNotice("Recovered unsaved changes from this browser tab. Save checks the original draft revision.");
      }
    });
    return () => { active = false; };
  }, [recoveryKey]);
  useEffect(() => {
    if (!recoveryReady.current) return;
    try {
      if (dirty) sessionStorage.setItem(recoveryKey, JSON.stringify({ name, instructions, configuration: config, draft: draftBase.current }));
      else sessionStorage.removeItem(recoveryKey);
    } catch { /* Navigation confirmation remains available without recovery storage. */ }
  }, [recoveryKey, dirty, name, instructions, config]);
  function markDirty() {
    if (!dirty) draftBase.current = agent.draft_number;
    setDirty(true);
  }
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a");
      if (
        anchor?.href &&
        !window.confirm("You have unsaved agent changes. Leave this editor?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  function update(key: keyof AgentConfiguration, value: string | string[]) {
    setConfig((c) => ({ ...c, [key]: value }));
    markDirty();
  }
  function selectSection(next: string) {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
  }
  function save() {
    start(async () => {
      setError("");
      const result = await saveAgent(organizationId, {
        id: agent.id,
        name,
        instructions,
        configuration: config as never,
        draft: draftBase.current,
      });
      if (result.error) setError(result.error);
      else {
        setDirty(false);
        setNotice(
          "Draft saved. Published deployments retain their selected version.",
        );
        router.refresh();
      }
    });
  }
  function publish(status: "active" | "disabled") {
    if (dirty) {
      setError("Save your draft before changing lifecycle.");
      return;
    }
    if (
      !window.confirm(
        status === "active"
          ? "Publish this draft as a new immutable version? Existing deployments keep their selected version."
          : "Disable this agent across its deployments?",
      )
    )
      return;
    start(async () => {
      const result = await publishAgent(
        organizationId,
        agent.id,
        agent.draft_number,
        status,
      );
      if (result.error) setError(result.error);
      else {
        setNotice(
          status === "active"
            ? "Version published. Select it in each deployment to adopt it."
            : "Agent disabled.",
        );
        router.refresh();
      }
    });
  }
  return (
    <AppPage className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link aria-label="Back to agents" href={`${base}/agents`}>
            <ArrowLeft size={18} />
          </Link>
          <AgentIcon />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{agent.name}</h1>
            <p className="text-xs text-muted">
              Draft {agent.draft_number} ·{" "}
              {versions.length
                ? `Latest published v${versions[0].version_number}`
                : "No published version"}
            </p>
          </div>
          <Badge>{agent.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" onClick={() => selectSection("testing")}>
            <Play size={14} />
            Test
          </Button>
          <Button disabled={pending || !canManage || !dirty} onClick={save}>
            <Save size={14} />
            Save draft
          </Button>
          <Button
            tone="secondary"
            disabled={pending || !canManage}
            onClick={() => publish("active")}
          >
            Publish version
          </Button>
          {agent.status === "active" && (
            <Button
              tone="secondary"
              disabled={pending || !canManage}
              onClick={() => publish("disabled")}
            >
              Disable
            </Button>
          )}
          {agent.status === "draft" && !versions.length && !deployments.length && canManage && (
            <Button tone="secondary" disabled={pending} onClick={() => {
              if (!window.confirm("Delete this unpublished draft? This cannot be undone.")) return;
              start(async () => {
                const result = await deleteAgent(organizationId, agent.id);
                if (result.error) setError(result.error);
                else { setDirty(false); router.push(`${base}/agents`); }
              });
            }}>Delete draft</Button>
          )}
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-accent-text">
          {notice}
        </p>
      )}
      <div className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-[150px_minmax(0,1fr)] ${channelOpen ? "" : "xl:grid-cols-[160px_minmax(0,1fr)_260px]"}`}>
        <nav
          className="hidden space-y-1 lg:block"
          aria-label="Agent configuration"
        >
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => selectSection(s)}
              className={`w-full rounded-md px-3 py-2 text-left text-sm ${section === s ? "bg-selected font-medium text-accent-text" : "text-muted hover:bg-secondary"}`}
            >
              {LABELS[s]}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="lg:hidden">
            <SelectField aria-label="Configuration section" value={section} onValueChange={(next) => selectSection(next)} options={[...SECTIONS.map((s) => ({ value: s, label: LABELS[s] }))]} />
          </div>
          {section === "overview" && (
            <OperationalPanel title="Agent identity">
              <div className="space-y-5">
                <Field label="Name">
                  <TextInput
                    disabled={!canManage}
                    value={name}
                    maxLength={100}
                    onChange={(e) => {
                      setName(e.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Purpose">
                  <SelectField disabled={!canManage} value={config.purpose ?? "General assistant"} onValueChange={(next) => update("purpose", next)} options={[...[
                      "General assistant",
                      "Customer service",
                      "Sales assistant",
                      "Support assistant",
                      "Scheduling assistant",
                      "Receptionist",
                    ].map((p) => ({ value: p, label: p }))]} />
                </Field>
                <Field label="Description">
                  <TextArea
                    disabled={!canManage}
                    value={config.description ?? ""}
                    maxLength={1000}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
                  <div>
                    <strong>{deployments.length}</strong>
                    <p className="text-xs text-muted">Deployments</p>
                  </div>
                  <div>
                    <strong>
                      {
                        data.knowledge.filter(
                          (k) => k.assistant_id === agent.id,
                        ).length
                      }
                    </strong>
                    <p className="text-xs text-muted">Draft sources</p>
                  </div>
                  <div>
                    <strong>{config.tools?.length ?? 0}</strong>
                    <p className="text-xs text-muted">Allowed tools</p>
                  </div>
                </div>
              </div>
            </OperationalPanel>
          )}
          {section === "instructions" && (
            <OperationalPanel title="Instructions">
              <div className="space-y-5">
                <p className="text-xs text-muted">
                  Tenant instructions shape behavior beneath platform rules.
                  Retrieved material cannot grant permissions.
                </p>
                <Field label="Core instructions">
                  <TextArea
                    className="min-h-52"
                    disabled={!canManage}
                    value={instructions}
                    maxLength={8000}
                    onChange={(e) => {
                      setInstructions(e.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Tone & communication style">
                  <TextInput
                    disabled={!canManage}
                    value={config.tone ?? ""}
                    maxLength={500}
                    onChange={(e) => update("tone", e.target.value)}
                  />
                </Field>
                <Field label="Boundaries & business-specific behavior">
                  <TextArea
                    disabled={!canManage}
                    value={config.boundaries ?? ""}
                    maxLength={2000}
                    onChange={(e) => update("boundaries", e.target.value)}
                  />
                </Field>
                <Field label="Escalation policy">
                  <TextArea
                    disabled={!canManage}
                    value={config.escalation ?? ""}
                    maxLength={1000}
                    onChange={(e) => update("escalation", e.target.value)}
                  />
                </Field>
              </div>
            </OperationalPanel>
          )}
          {section === "channels" && (
            <OperationalPanel
              title="Channel deployments"
              action={
                <Button
                  tone="secondary"
                  disabled={!canManage || !versions.length}
                  onClick={() => {
                    setDeployment(null);
                    setChannelOpen(true);
                  }}
                >
                  <Plus size={14} />
                  Add channel
                </Button>
              }
            >
              <div className="divide-y divide-border">
                {deployments.map((d) => (
                  <button
                    key={d.id}
                    className="flex w-full items-center justify-between gap-3 py-4 text-left"
                    onClick={() => {
                      setDeployment(d);
                      setChannelOpen(true);
                    }}
                  >
                    <span>
                      <strong className="block text-sm">
                        {d.display_name}
                      </strong>
                      <span className="text-xs text-muted">
                        {CHANNELS[d.surface as Channel]} · v
                        {versions.find((v) => v.id === d.version_id)
                          ?.version_number ?? "Legacy"}
                      </span>
                    </span>
                    <Badge>
                      {data.readiness.find((r) => r.id === d.id)?.state ??
                        "Unavailable"}
                    </Badge>
                  </button>
                ))}
                {!deployments.length && (
                  <PanelState>
                    {versions.length
                      ? "No channels configured. Add a deployment."
                      : "Publish an agent version to configure channels."}
                  </PanelState>
                )}
              </div>
            </OperationalPanel>
          )}
          {section === "knowledge" && (
            <OperationalPanel title="Knowledge sources">
              <div className="space-y-4">
                {data.sites
                  .filter((s) => s.current_published_revision_id)
                  .map((s) => (
                    <label
                      key={s.id}
                      className="flex gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={!canManage || pending || dirty}
                        checked={data.knowledge.some(
                          (k) =>
                            k.assistant_id === agent.id &&
                            k.public_site_id === s.id,
                        )}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          start(async () => {
                            const result = await setKnowledge(
                              organizationId,
                              agent.id,
                              s.id,
                              checked,
                            );
                            if (result.error) setError(result.error);
                            else {
                              setNotice(
                                "Draft knowledge selection saved. Publish a version to deploy it.",
                              );
                              router.refresh();
                            }
                          });
                        }}
                      />
                      <span>
                        <strong className="block">{`Website ${s.id.slice(0, 8)}`}</strong>
                        <span className="text-xs text-muted">
                          Current published revision · public text only
                        </span>
                      </span>
                    </label>
                  ))}
                {dirty && (
                  <p className="text-xs text-warning">
                    Save your draft before changing source associations.
                  </p>
                )}
                {!data.sites.some((s) => s.current_published_revision_id) && (
                  <PanelState>
                    Publish a website in Studio before adding knowledge.
                  </PanelState>
                )}
              </div>
            </OperationalPanel>
          )}
          {section === "tools" && (
            <OperationalPanel title="Tools & permissions">
              <div className="space-y-4">
                <Field label="Action policy">
                  <SelectField disabled={!canManage} value={config.policy ?? "read_only"} onValueChange={(next) => update("policy", next)} options={[{ value: 'read_only', label: 'Read only' }, { value: 'suggest', label: 'Suggest actions · human decision required' }, { value: 'human_approval', label: 'Human approval required' }]} />
                </Field>
                <p className="text-xs text-muted">
                  These tools are available to the Operator Copilot only.
                  Assignment never expands the signed-in person’s authorization.
                  Public and safe preview contexts cannot execute them.
                </p>
                {TOOL_CATALOGUE.map((t) => (
                  <label
                    key={t.key}
                    className="flex items-start gap-3 border-t border-border pt-4 text-sm"
                  >
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={config.tools?.includes(t.key) ?? false}
                      onChange={(e) =>
                        update(
                          "tools",
                          e.target.checked
                            ? [...(config.tools ?? []), t.key]
                            : (config.tools ?? []).filter((k) => k !== t.key),
                        )
                      }
                    />
                    <span>
                      <strong className="block">{t.name}</strong>
                      <span className="text-xs text-muted">
                        {t.description} Read · {t.owner}
                      </span>
                    </span>
                  </label>
                ))}
                <p className="border-t border-border pt-4 text-xs text-muted">
                  Reschedule proposals require a human decision in the global
                  rail and canonical Work authorization at execution.
                </p>
                <div className="space-y-2 border-t border-border pt-4 text-sm">
                  <strong className="block">Connected tools</strong>
                  <p className="text-xs text-muted">
                    Tools from connected apps and MCP servers are given in Connections, never here. A tool an MCP server offers always waits for a person to approve each use.
                  </p>
                  {connectedTools.length === 0 ? (
                    <p className="text-xs text-muted">Nothing from a connected app has been given to this agent.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {connectedTools.map((tool) => (
                        <li key={tool.id} className="py-2">
                          <span className="block">{tool.label}</span>
                          <span className="text-xs text-muted">
                            {tool.source}
                            {tool.needsApproval ? " · a person approves each use" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/settings/connections/mcp`}>
                    Manage connected tools
                  </ButtonLink>
                </div>
              </div>
            </OperationalPanel>
          )}
          {section === "handoff" && (
            <OperationalPanel title="Human handoff">
              <div className="space-y-4">
                <Field label="Escalation policy">
                  <TextArea
                    disabled={!canManage}
                    value={config.escalation ?? ""}
                    maxLength={1000}
                    onChange={(e) => update("escalation", e.target.value)}
                  />
                </Field>
                <p className="text-sm text-muted">
                  Website conversations requesting a human remain in
                  Communications. SMS and email sending remain human-supervised.
                  Voice transfer requires the canonical call routing runtime.
                </p>
                <ButtonLink
                  tone="secondary"
                  href={`/organizations/${organizationId}/comms/inbox/website`}
                >
                  Open Conversations
                </ButtonLink>
                <Button
                  tone="secondary"
                  onClick={() => selectSection("channels")}
                >
                  Configure channel handoff messages
                </Button>
              </div>
            </OperationalPanel>
          )}
          {section === "testing" && (
            <Testing
              organizationId={organizationId}
              agent={agent}
              versions={versions}
              canManage={canManage}
              initial={data.evaluations.filter(
                (e) => e.assistant_id === agent.id,
              )}
            />
          )}
          {section === "activity" && (
            <OperationalPanel title="Agent activity">
              <ButtonLink tone="secondary" href={`${base}/activity`}>
                Open activity inspector
              </ButtonLink>
              <div className="mt-4 divide-y divide-border">
                {data.runs.filter(r => versions.some(v => v.id === r.assistant_version_id)).map(r => (
                  <Link key={r.id} href={`${base}/activity?run=${r.id}`} className="block py-3 text-sm">
                    <Badge>{r.outcome}</Badge>
                    <p className="mt-2 truncate">{r.question}</p>
                    <p className="mt-1 text-xs text-muted">{new Date(r.occurred_at).toLocaleString()}</p>
                  </Link>
                ))}
                {data.evaluations
                  .filter((e) => e.assistant_id === agent.id)
                  .map((e) => (
                    <div key={e.id} className="py-3 text-sm">
                      <Badge>{e.outcome}</Badge>
                      <p className="mt-2">{e.scenario}</p>
                    </div>
                  ))}
              </div>
            </OperationalPanel>
          )}
          {section === "versions" && (
            <OperationalPanel title="Published versions">
              {versions.map((v) => (
                <button
                  key={v.id}
                  className="flex w-full justify-between gap-3 border-b border-border py-4 text-left text-sm"
                  onClick={() => setVersionInspected(v.id)}
                >
                  <span>
                    Version {v.version_number} · {v.name}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                </button>
              ))}
              {!versions.length && <PanelState>No version published yet.</PanelState>}
            </OperationalPanel>
          )}
        </div>
        <aside className={`${channelOpen ? "hidden" : ""} min-w-0 space-y-4 lg:col-start-2 xl:col-start-auto`}>
          <OperationalPanel title="Readiness inspector">
            <div className="space-y-4 text-xs">
              <div className="flex justify-between gap-2">
                <span>Local changes</span>
                <Badge>{dirty ? "Unsaved" : "Saved"}</Badge>
              </div>
              <div className="flex justify-between gap-2">
                <span>Instructions</span>
                <Badge>{instructions.trim() ? "Configured" : "Missing"}</Badge>
              </div>
              <div className="flex justify-between gap-2">
                <span>Published versions</span>
                <span>{versions.length}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Enabled channels</span>
                <span>{deployments.filter((d) => d.enabled).length}</span>
              </div>
              <p className="border-t border-border pt-3 text-muted">
                Editing a draft does not update deployed behavior. Publish,
                test, then select the version in each channel.
              </p>
            </div>
          </OperationalPanel>
          <OperationalPanel title="Operator Copilot">
            <ShieldCheck size={20} className="text-accent-text" />
            <Button
              tone="secondary"
              onClick={() => {
                if (!agentOpen) toggleAgent();
              }}
            >
              Open Agent
            </Button>
          </OperationalPanel>
        </aside>
      </div>
      {channelOpen && (
        <DeploymentEditor
          key={deployment?.id ?? "new"}
          organizationId={organizationId}
          agent={agent}
          data={data}
          deployment={deployment}
          canManage={canManage}
          close={() => setChannelOpen(false)}
        />
      )}
      <PageDrawer
        open={Boolean(versionInspected)}
        onOpenChange={(open) => {
          if (!open) setVersionInspected(null);
        }}
      >
        <PageDrawerContent>
          <PageDrawerHeader>
            <PageDrawerTitle>Published configuration</PageDrawerTitle>
            <PageDrawerDescription>
              Immutable version evidence
            </PageDrawerDescription>
          </PageDrawerHeader>
          <PageDrawerBody>
            {versions
              .filter((v) => v.id === versionInspected)
              .map((v) => (
                <div key={v.id} className="space-y-4 text-sm">
                  <Badge>Version {v.version_number}</Badge>
                  <h3 className="font-medium">{v.name}</h3>
                  <p className="whitespace-pre-wrap">{v.instructions}</p>
                  <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(v.configuration, null, 2)}
                  </pre>
                  <p>{v.knowledge_site_ids.length} published-site sources</p>
                </div>
              ))}
          </PageDrawerBody>
        </PageDrawerContent>
      </PageDrawer>
    </AppPage>
  );
}

function Testing({
  organizationId,
  agent,
  versions,
  canManage,
  initial,
}: {
  organizationId: string;
  agent: Agent;
  versions: AiWorkspaceData["versions"];
  canManage: boolean;
  initial: Evaluation[];
}) {
  const [version, setVersion] = useState(versions[0]?.id ?? ""),
    [question, setQuestion] = useState(""),
    [criterion, setCriterion] = useState(""),
    [results, setResults] = useState(initial),
    [error, setError] = useState(""),
    [pending, start] = useTransition();
  return (
    <OperationalPanel title="Agent testing playground">
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-secondary p-3 text-xs">
          <strong>Safe preview</strong>
          <p className="mt-1 text-muted">
            Uses a published version and public knowledge. No business tools,
            writes, SMS, email or calls. Model requests consume the
            organization’s AI allowance.
          </p>
        </div>
        <Field label="Published version">
          <SelectField value={version} onValueChange={(next) => setVersion(next)} options={[...(!versions.length ? [{ value: '', label: 'Publish a version first' }] : []), ...versions.map((v) => ({ value: v.id, label: `Version ${v.version_number}` }))]} />
        </Field>
        <Field label="Test question">
          <TextArea
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Can you help me find your opening hours?"
          />
        </Field>
        <Field label="Expected behavior">
          <TextArea
            value={criterion}
            maxLength={1000}
            onChange={(e) => setCriterion(e.target.value)}
            placeholder="Answer only from selected published sources or explain what is missing."
          />
        </Field>
        <Button
          disabled={
            !canManage ||
            pending ||
            !version ||
            !question.trim() ||
            !criterion.trim()
          }
          onClick={() =>
            start(async () => {
              setError("");
              const result = await testAgent(
                organizationId,
                agent.id,
                version,
                question,
                criterion,
              );
              if (result.error) setError(result.error);
              else if (result.evaluation)
                setResults((r) => [result.evaluation!, ...r]);
            })
          }
        >
          {pending ? "Testing…" : "Run safe preview"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="space-y-4">
          {results.map((r) => (
            <article
              key={r.id}
              className="space-y-3 rounded-lg border border-border p-4 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <Badge>{r.outcome}</Badge>
                <Badge>{r.verdict ?? "Human assessment required"}</Badge>
              </div>
              <p className="font-medium">{r.scenario}</p>
              <p className="whitespace-pre-wrap rounded-md bg-secondary p-3">
                {r.answer || r.detail || "No answer returned."}
              </p>
              <p className="text-xs text-muted">Criterion: {r.criterion}</p>
              <p className="text-xs text-muted">
                Policy: no tools, no actions. Published website text only. No
                hidden reasoning is recorded.
              </p>
              <div className="flex gap-2">
                {(["passed", "failed"] as const).map((verdict) => (
                  <Button
                    key={verdict}
                    tone="secondary"
                    disabled={pending || !canManage}
                    onClick={() =>
                      start(async () => {
                        const result = await evaluateResult(
                          organizationId,
                          r.id,
                          verdict,
                        );
                        if (result.error) setError(result.error);
                        else
                          setResults((rs) =>
                            rs.map((item) =>
                              item.id === r.id ? { ...item, verdict } : item,
                            ),
                          );
                      })
                    }
                  >
                    Mark {verdict}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </OperationalPanel>
  );
}

function DeploymentEditor({
  organizationId,
  agent,
  data,
  deployment,
  canManage,
  close,
}: {
  organizationId: string;
  agent: Agent;
  data: AiWorkspaceData;
  deployment: Deployment | null;
  canManage: boolean;
  close: () => void;
}) {
  const router = useRouter(),
    versions = data.versions.filter((v) => v.assistant_id === agent.id),
    existing = (deployment?.configuration ?? {}) as Record<string, string>;
  const [surface, setSurface] = useState<Channel>(
      (deployment?.surface as Channel) ?? "website_chat",
    ),
    [version, setVersion] = useState(
      deployment?.version_id ?? versions[0]?.id ?? "",
    ),
    [site, setSite] = useState(deployment?.public_site_id ?? ""),
    [enabled, setEnabled] = useState(deployment?.enabled ?? false),
    [error, setError] = useState(""),
    [pending, start] = useTransition(),
    [preview, setPreview] = useState(false),
    [dirty, setDirty] = useState(false);
  const supported =
    surface === "website_chat" || surface === "operator_copilot";
  function dismiss() {
    if (!dirty || window.confirm("Discard unsaved channel changes?")) close();
  }
  return (
    <PageDrawer
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{CHANNELS[surface]} deployment</PageDrawerTitle>
          <PageDrawerDescription>
            Channel policy and explicit published version.
          </PageDrawerDescription>
        </PageDrawerHeader>
        <form
          id="deployment-form"
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            start(async () => {
              const config: Record<string, string> = {};
              for (const key of [
                "instructions",
                "identity",
                "hours",
                "language",
                "voice",
                "recording",
                "retention",
                "duration",
                "fallback",
                "handoffDestination",
                "signature",
                "routing",
              ])
                config[key] = String(form.get(key) ?? "");
              const result = await saveDeployment(organizationId, {
                id: deployment?.id ?? null,
                agentId: agent.id,
                versionId: version,
                surface,
                siteId: surface === "website_chat" ? site : null,
                enabled,
                name: String(form.get("name")),
                greeting: String(form.get("greeting")),
                handoff: String(form.get("handoff")),
                configuration: config,
              });
              if (result.error) setError(result.error);
              else {
                setDirty(false);
                close();
                router.refresh();
              }
            });
          }}
        >
          <div className="space-y-5">
            <Field label="Channel">
              <SelectField disabled={Boolean(deployment) || !canManage} value={surface} onValueChange={(next) => {
                  setSurface(next as Channel);
                  setEnabled(false);
                }} options={[...Object.entries(CHANNELS).map(([key, label]) => ({ value: key, label: label }))]} />
            </Field>
            <Field label="Effective published version">
              <SelectField disabled={!canManage} value={version} onValueChange={(next) => setVersion(next)} options={[...versions.map((v) => ({ value: v.id, label: `Version ${v.version_number}` }))]} />
            </Field>
            <Field label="Display name">
              <TextInput
                name="name"
                disabled={!canManage}
                defaultValue={deployment?.display_name ?? agent.name}
                required
                maxLength={80}
              />
            </Field>
            {surface === "website_chat" && (
              <Field label="Published website">
                <SelectField disabled={Boolean(deployment) || !canManage} value={site} onValueChange={(next) => setSite(next)} options={[{ value: '', label: 'Select website' }, ...data.sites
                    .filter((s) => s.current_published_revision_id).map((s) => ({ value: s.id, label: `Website ${s.id.slice(0, 8)}` }))]} />
              </Field>
            )}
            {!supported && (
              <div className="rounded-md border border-border bg-secondary p-3 text-sm">
                <strong>Runtime unavailable</strong>
                <p className="mt-1 text-xs text-muted">
                  {surface === "voice"
                    ? "There is no conversational audio runtime. A phone number, greeting or voice preference does not make this a functioning receptionist."
                    : "This deployment stores channel policy only. Automated response execution is not available."}{" "}
                  Activation is blocked on the server.
                </p>
              </div>
            )}
            {surface !== "website_chat" && surface !== "operator_copilot" && (
              <Field
                label={
                  surface === "voice" || surface === "sms"
                    ? "Communications phone/routing identity reference"
                    : surface === "email"
                      ? "Verified email identity reference"
                      : surface === "support"
                        ? "Support queue reference"
                        : "Portal identity scope"
                }
              >
                <TextInput
                  name="identity"
                  disabled={!canManage}
                  defaultValue={existing.identity ?? ""}
                  maxLength={200}
                  placeholder="Configuration reference only; runtime not connected"
                />
              </Field>
            )}
            <Field label="Greeting">
              <TextArea
                name="greeting"
                disabled={!canManage}
                defaultValue={deployment?.greeting ?? "Hello. How can I help?"}
                required
                maxLength={1000}
              />
            </Field>
            <Field label="Channel instructions">
              <TextArea
                name="instructions"
                disabled={!canManage}
                defaultValue={existing.instructions ?? ""}
                maxLength={2000}
              />
            </Field>
            <Field label="Human handoff message">
              <TextArea
                name="handoff"
                disabled={!canManage}
                defaultValue={
                  deployment?.handoff_message ??
                  "Your request has been recorded for the team. Please contact the business directly if urgent."
                }
                required
                maxLength={1000}
              />
            </Field>
            <Field label="Handoff destination reference">
              <TextInput
                name="handoffDestination"
                disabled={!canManage}
                defaultValue={existing.handoffDestination ?? ""}
                maxLength={500}
              />
            </Field>
            {["voice", "sms", "email"].includes(surface) && (
              <Field label="Business-hours behavior">
                <TextArea
                  name="hours"
                  disabled={!canManage}
                  defaultValue={existing.hours ?? ""}
                  maxLength={1000}
                />
              </Field>
            )}
            {surface === "email" && (
              <>
                <Badge>Human review required · draft assistance</Badge>
                <Field label="Signature rules">
                  <TextArea
                    name="signature"
                    disabled={!canManage}
                    defaultValue={existing.signature ?? ""}
                    maxLength={1000}
                  />
                </Field>
              </>
            )}
            {surface === "sms" && (
              <p className="text-xs text-muted">
                Replies need human review, and no automated SMS will be sent.
              </p>
            )}
            {surface === "voice" && (
              <>
                {[
                  ["routing", "Inbound routing reference"],
                  ["language", "Language"],
                  ["voice", "Preferred voice (availability unverified)"],
                  ["recording", "Recording / disclosure policy"],
                  ["retention", "Conversation retention"],
                  ["duration", "Maximum call duration (seconds)"],
                  ["fallback", "Timeout / failure fallback"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <TextInput
                      name={key}
                      disabled={!canManage}
                      defaultValue={existing[key] ?? ""}
                      maxLength={500}
                    />
                  </Field>
                ))}
                <p className="text-xs text-muted">
                  No voice test is recorded.
                </p>
              </>
            )}
            <label className="flex gap-3 text-sm">
              <input
                type="checkbox"
                disabled={!canManage || !supported}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                Enable deployment
                <span className="mt-1 block text-xs text-muted">
                  Requires active agent, entitlement and published version.
                  Enabled does not establish provider health.
                </span>
              </span>
            </label>
            {surface === "website_chat" && deployment?.enabled && site && (
              <>
                <Button
                  type="button"
                  tone="secondary"
                  onClick={() => setPreview((p) => !p)}
                >
                  <Globe size={14} />
                  {preview ? "Close live widget" : "Open live widget preview"}
                </Button>
                <p className="text-xs text-muted">
                  Live widget sends real test messages through the public
                  runtime and records them in Communications.
                </p>
                {preview && (
                  <PublicCommunicationWidget
                    siteId={site}
                    name={deployment.display_name}
                    greeting={deployment.greeting}
                  />
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        </form>
          <PageDrawerFooter>
            {deployment && !deployment.enabled && canManage && (
              <Button type="button" tone="secondary" disabled={pending} onClick={() => {
                if (!window.confirm("Delete this disabled deployment? Deployments with conversation history are retained.")) return;
                start(async () => {
                  const result = await deleteDeployment(organizationId, deployment.id);
                  if (result.error) setError(result.error);
                  else { close(); router.refresh(); }
                });
              }}>Delete deployment</Button>
            )}
            <Button type="button" tone="secondary" onClick={dismiss}>
              Cancel
            </Button>
            <Button type="submit" form="deployment-form"
              disabled={
                pending ||
                !canManage ||
                !version ||
                (surface === "website_chat" && !site)
              }
            >
              {pending ? "Saving…" : "Save deployment"}
            </Button>
          </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}
