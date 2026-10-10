"use client";
import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { ViewNavigation } from "@/components/operational/primitives";
export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  const value = String(children).toLowerCase();
  const color = ["active", "passed", "answered", "enabled"].includes(value)
    ? "bg-success/10 text-success"
    : ["unavailable", "pending", "handoff_requested"].includes(value)
      ? "bg-warning/10 text-warning"
      : ["failed"].includes(value)
        ? "bg-danger/10 text-danger"
        : ["draft", "configured"].includes(value)
          ? "bg-selected text-accent-text"
          : "bg-secondary text-foreground";
  return (
    <span className={`inline-flex shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${color}`}>
      {children}
    </span>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
export function AgentIcon() {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-selected text-accent-text">
      <Bot size={18} />
    </span>
  );
}
const AI_VIEWS: [string, string][] = [
  ["", "Overview"],
  ["agents", "Agents"],
  ["deployments", "Channels"],
  ["knowledge", "Knowledge"],
  ["tools", "Tools"],
  ["activity", "Activity"],
  ["evaluations", "Evaluations"],
];
export function AiNav({ base, active }: { base: string; active: string }) {
  return (
    <ViewNavigation
      label="AI workspace"
      items={AI_VIEWS.map(([path, label]) => ({
        key: path || "overview",
        label,
        href: `${base}${path ? `/${path}` : ""}`,
        current: active === path,
      }))}
    />
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export const cell = "px-3 py-2 text-left align-top text-xs";
