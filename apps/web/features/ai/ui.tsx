"use client";

import { ViewNav } from '@/components/navigation/view-nav';
import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { StatePill } from "@/components/operational/primitives";
/** Agent, deployment and run states are platform facts, so they may carry a tone; anything else is neutral. */
export function Badge({ children }: { children: ReactNode }) {
  const value = String(children).toLowerCase();
  const tone = ["active", "passed", "answered", "enabled"].includes(value)
    ? "success"
    : ["unavailable", "pending", "handoff_requested"].includes(value)
      ? "warning"
      : value === "failed"
        ? "danger"
        : "neutral";
  return <StatePill tone={tone}>{children}</StatePill>;
}
export function AgentIcon() {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted">
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
    <ViewNav
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
