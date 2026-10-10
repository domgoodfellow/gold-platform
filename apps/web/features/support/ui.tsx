import { cloneElement, isValidElement, type ReactNode } from "react";
import { PanelState, StatePill } from "@/components/operational/primitives";

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
          <thead className="border-b border-border bg-secondary text-[11px] text-muted">
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
      {!hasRows && <PanelState>{empty}</PanelState>}
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
