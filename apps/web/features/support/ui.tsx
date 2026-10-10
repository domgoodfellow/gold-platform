import Link from "next/link";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { StatePill } from "@/components/operational/primitives";

export function Badge({ value }: { value: string }) {
  // Support's own vocabulary: priority and breach state are platform facts, so they may carry a tone. A case's queue or custom label never does.
  const tone = ["urgent", "overdue"].includes(value)
    ? "danger"
    : ["high", "escalated"].includes(value)
      ? "warning"
      : value === "resolved"
        ? "success"
        : "neutral";
  return <StatePill tone={tone}>{value.replaceAll("_", " ")}</StatePill>;
}
export function Panel({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  action?: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="text-xs font-medium text-accent-text hover:underline"
          >
            View all
          </Link>
        ) : (
          action
        )}
      </div>
      {children}
    </section>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-28 items-center justify-center border-t border-border p-5 text-center text-sm text-muted">
      {children}
    </div>
  );
}
export const cell = "px-3 py-2.5 align-middle";
export function Table({
  headings,
  children,
  empty,
  hasRows,
}: {
  headings: string[];
  children: ReactNode;
  empty: string;
  hasRows: boolean;
}) {
  return (
    <>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-y border-border bg-surface/60 text-[11px] text-muted">
            <tr>
              {headings.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{children}</tbody>
        </table>
      </div>
      {!hasRows && <Empty>{empty}</Empty>}
    </>
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
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      {isValidElement<Record<string, unknown>>(children)
        ? cloneElement(children, {
            "aria-label": children.props["aria-label"] ?? label,
          })
        : children}
    </label>
  );
}
export function formatTime(value: string | null, timezone: string) {
  return value
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "No target";
}
