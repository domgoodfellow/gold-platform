"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@gold/ui/components/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@gold/ui/components/popover";
import { Progress } from "@gold/ui/components/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@gold/ui/components/tooltip";
import { Button } from "@/components/controls/button";
import { cx } from "@/components/class-names";

export type OperationalTone =
  | "blue"
  | "amber"
  | "rose"
  | "green"
  | "violet"
  | "neutral";
const tones: Record<OperationalTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  green: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
  neutral: "bg-slate-100 text-slate-600",
};

export function StatePill({
  tone = "neutral",
  children,
}: {
  tone?: OperationalTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium capitalize leading-4",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function IconWell({
  icon: Icon,
  tone = "blue",
  round = false,
}: {
  icon: LucideIcon;
  tone?: OperationalTone;
  round?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center",
        round ? "rounded-full" : "rounded-lg",
        tones[tone],
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

export function MetricTile({
  label,
  value,
  detail,
  icon,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: LucideIcon;
  tone: OperationalTone;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-start gap-3 rounded-md border border-slate-200/80 bg-background px-3.5 py-3 transition-colors hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <IconWell icon={icon} tone={tone} round />
      <div className="min-w-0">
        <div className="text-[23px] font-semibold leading-7 tracking-tight tabular-nums">
          {value}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-1 text-[11px] text-slate-500">{detail}</div>
      </div>
    </Link>
  );
}

export function OperationalPanel({
  title,
  count,
  href,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  href?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "min-w-0 overflow-hidden rounded-md border border-slate-200/80 bg-background",
        className,
      )}
    >
      <div className="flex h-11 items-center justify-between gap-2 px-3.5">
        <h2
          aria-label={title}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          {title}
          {count !== undefined && (
            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">
              {count}
            </span>
          )}
        </h2>
        {href ? (
          <Link
            href={href}
            className="text-xs font-medium text-blue-600 hover:underline"
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

export function FilterMenu({
  label,
  name,
  value,
  options,
  onValueChange,
  icon: Icon,
  className,
}: {
  label: string;
  name?: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  icon?: LucideIcon;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {name && <input type="hidden" name={name} value={value} />}
      <PopoverTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          className={cx(
            "h-9 min-w-20 max-w-28 justify-between gap-2 rounded-md border-slate-200 px-3 text-xs font-normal shadow-none",
            className,
          )}
          aria-label={`${label}: ${options.find((o) => o.value === value)?.label ?? label}`}
        >
          {Icon && <Icon className="size-4 shrink-0 text-slate-500" />}
          <span className="truncate">
            {options.find((o) => o.value === value)?.label ?? label}
          </span>
          <ChevronDown className="size-3 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 rounded-md p-1.5">
        <fieldset>
          <legend className="px-2 py-1.5 text-xs font-semibold text-slate-500">
            {label}
          </legend>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-slate-50 focus-within:bg-blue-50"
            >
              <input
                className="size-3.5 accent-blue-600"
                type="radio"
                name={id}
                checked={value === o.value}
                onChange={() => {
                  onValueChange(o.value);
                  setOpen(false);
                }}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

export function OwnerIdentity({
  name,
  compact = false,
}: {
  name: string | null;
  compact?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 whitespace-nowrap text-xs">
      <Avatar className="size-6 shrink-0">
        <AvatarFallback className="bg-slate-200/80 text-[10px] font-semibold text-slate-600">
          {name ? (
            name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0])
              .join("")
              .toUpperCase()
          ) : (
            <UserRound className="size-3 text-slate-400" />
          )}
        </AvatarFallback>
      </Avatar>
      {!compact && (
        <span className={cx("truncate", !name && "text-slate-500")}>
          {name ?? "Unassigned"}
        </span>
      )}
    </span>
  );
}

function subscribeClock(callback: () => void) {
  const timer = setInterval(callback, 30000);
  return () => clearInterval(timer);
}
const minuteSnapshot = () => Math.floor(Date.now() / 30000) * 30000;
const serverSnapshot = () => null;
export function RelativeTime({
  value,
  deadline = false,
  active = true,
  timezone,
  stacked = false,
}: {
  value: string | null;
  deadline?: boolean;
  active?: boolean;
  timezone: string;
  stacked?: boolean;
}) {
  const now = useSyncExternalStore(
    subscribeClock,
    minuteSnapshot,
    serverSnapshot,
  );
  if (!value) return <span className="text-slate-400">No target</span>;
  const date = new Date(value);
  const exact = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  const difference = date.getTime() - (now ?? date.getTime());
  const minutes = Math.max(1, Math.round(Math.abs(difference) / 60000));
  const duration =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  const overdue = deadline && active && now !== null && difference < 0;
  const label =
    now === null
      ? date.toISOString().slice(0, 10)
      : !deadline
        ? `${duration} ago`
        : !active
          ? "Target retained"
          : `${duration}${overdue ? " overdue" : " remaining"}`;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <time
            dateTime={value}
            tabIndex={0}
            className={cx(
              "inline-block whitespace-nowrap text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              overdue
                ? "text-rose-600"
                : deadline && active
                  ? "text-amber-600"
                  : "text-slate-500",
            )}
          >
            {stacked && deadline && active && now !== null ? (
              <>
                <span className="block leading-4">{duration}</span>
                <span className="block text-[10px] leading-3">
                  {overdue ? "Overdue" : "Remaining"}
                </span>
              </>
            ) : (
              label
            )}
          </time>
        </TooltipTrigger>
        <TooltipContent>
          {exact} · {timezone}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RiskBar({ value, label }: { value: number; label: string }) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <span className="flex min-w-20 items-center gap-2">
      <Progress
        value={percent}
        aria-label={label}
        className={cx(
          "h-1.5 w-20 bg-slate-200",
          percent >= 30
            ? "[&_[data-slot=progress-indicator]]:bg-rose-500"
            : percent >= 15
              ? "[&_[data-slot=progress-indicator]]:bg-orange-500"
              : percent > 0
                ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
                : "[&_[data-slot=progress-indicator]]:bg-emerald-500",
        )}
      />
      <span
        className={cx(
          "w-7 text-right text-[11px] tabular-nums",
          percent >= 30 ? "text-rose-600" : "text-slate-500",
        )}
      >
        {percent}%
      </span>
    </span>
  );
}

export function ActivityList({
  items,
}: {
  items: {
    id: string;
    title: ReactNode;
    description: ReactNode;
    time: ReactNode;
    tone: OperationalTone;
    href: string;
  }[];
}) {
  return (
    <ol className="px-3.5 pb-2">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 py-2.5">
          {i < items.length - 1 && (
            <span
              className="absolute bottom-0 left-[5px] top-6 w-px bg-slate-200"
              aria-hidden="true"
            />
          )}
          <span
            className={cx(
              "relative mt-1 size-[11px] shrink-0 rounded-full border-2 bg-background",
              item.tone === "green"
                ? "border-emerald-500"
                : item.tone === "rose"
                  ? "border-rose-500"
                  : item.tone === "violet"
                    ? "border-violet-500"
                    : "border-blue-500",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 border-b border-slate-100 pb-2">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={item.href}
                className="truncate text-xs font-semibold hover:text-blue-600"
              >
                {item.title}
              </Link>
              <span className="shrink-0 text-[10px] text-slate-500">
                {item.time}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">
              {item.description}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ResourceTile({
  title,
  description,
  icon,
  href,
  tone = "blue",
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  tone?: OperationalTone;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-start gap-2.5 rounded-md border border-slate-200/80 bg-background p-3 transition-colors hover:border-blue-300"
    >
      <IconWell icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{title}</div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          {description}
        </p>
      </div>
      <ChevronRight className="mt-3 size-3.5 shrink-0 text-slate-400" />
    </Link>
  );
}

export function OperationalTable({
  headings,
  children,
  empty,
  hasRows,
  widths,
}: {
  headings: string[];
  children: ReactNode;
  empty: string;
  hasRows: boolean;
  widths?: string[];
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed text-left text-xs leading-4">
        <colgroup>
          {headings.map((h, i) => (
            <col
              key={h}
              style={widths?.[i] ? { width: widths[i] } : undefined}
            />
          ))}
        </colgroup>
        <thead className="border-y border-slate-200/80 bg-slate-50/80 text-[10px] text-slate-500">
          <tr>
            {headings.map((h) => (
              <th key={h} className="h-8 whitespace-nowrap px-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&_td]:h-11 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-middle">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={headings.length}>
                <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">
                  {empty}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
