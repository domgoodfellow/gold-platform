"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
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
    ? "bg-emerald-50 text-emerald-700"
    : ["unavailable", "pending", "handoff_requested"].includes(value)
      ? "bg-amber-50 text-amber-700"
      : ["failed"].includes(value)
        ? "bg-red-50 text-red-700"
        : ["draft", "configured"].includes(value)
          ? "bg-blue-50 text-blue-700"
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
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
      <Bot size={18} />
    </span>
  );
}
export function AiNav({ base, active }: { base: string; active: string }) {
  return (
    <nav
      aria-label="AI workspace"
      className="flex gap-5 overflow-x-auto border-b border-border text-sm"
    >
      {[
        ["", "Overview"],
        ["agents", "Agents"],
        ["deployments", "Channels"],
        ["knowledge", "Knowledge"],
        ["tools", "Tools"],
        ["activity", "Activity"],
        ["evaluations", "Evaluations"],
      ].map(([path, label]) => (
        <Link
          key={path}
          href={`${base}${path ? `/${path}` : ""}`}
          className={`shrink-0 border-b-2 py-3 ${active === path ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-muted"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
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
