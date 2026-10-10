"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Inbox,
  Lock,
  Settings2,
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
import { cx, FOCUS_RING } from "@/components/class-names";

/**
 * Colour on an operational surface states a fact, never decoration (ui-system, "Status colour").
 * `accent` is the organization's own colour and means "this one"; `success`, `warning` and
 * `danger` are platform-controlled and mean what they say whatever the brand is.
 */
export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";
const statusTones: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-muted",
  accent: "border-transparent bg-accent text-on-accent",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};
const toneText: Record<"warning" | "danger", string> = {
  warning: "text-warning",
  danger: "text-danger",
};

export function StatePill({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-medium capitalize leading-4",
        statusTones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A passive icon on a neutral well. Icons carry no colour of their own: a colour here would have to mean something. */
export function IconWell({
  icon: Icon,
  round = false,
}: {
  icon: LucideIcon;
  round?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center bg-secondary text-muted",
        round ? "rounded-full" : "rounded-lg",
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

/**
 * One figure: label, value, scope. Linked when it has a destination, plain otherwise. `emphasis`
 * colours the value only when the figure itself is a platform-reported exception.
 */
export function MetricTile({
  label,
  value,
  detail,
  icon,
  href,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  emphasis?: "warning" | "danger";
}) {
  const body = (
    <>
      {icon ? <IconWell icon={icon} round /> : null}
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div
          className={cx(
            "text-2xl font-semibold leading-8 tracking-tight tabular-nums",
            emphasis && toneText[emphasis],
          )}
        >
          {value}
        </div>
        {detail ? <div className="mt-0.5 text-xs text-muted">{detail}</div> : null}
      </div>
    </>
  );
  const shell = "flex min-w-0 items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3";
  return href ? (
    <Link href={href} className={cx(shell, "transition-colors hover:bg-hover", FOCUS_RING)}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export type PanelStateKind = "empty" | "not-configured" | "unavailable" | "restricted";

/**
 * Why a region has nothing to show, said once. The kinds are different facts and are never
 * rendered alike: an empty region is a true zero; unavailable is a failed or unverified read, not
 * a zero; not-configured points at what is missing; restricted is about the viewer, not the data.
 */
export function PanelState({
  kind = "empty",
  children,
  action,
}: {
  kind?: PanelStateKind;
  children: ReactNode;
  action?: ReactNode;
}) {
  const Icon = { empty: Inbox, "not-configured": Settings2, unavailable: CircleAlert, restricted: Lock }[kind];
  return (
    <div
      role={kind === "unavailable" ? "status" : undefined}
      data-state={kind}
      className="flex min-h-24 flex-col items-center justify-center gap-2 px-5 py-6 text-center text-sm text-muted"
    >
      <Icon aria-hidden className="size-4" />
      <p className="max-w-prose">{children}</p>
      {action}
    </div>
  );
}

/**
 * The standard section: a titled container with an optional count, destination link and action.
 * `flush` lets a table or list run edge to edge; otherwise the body is padded. `density` changes
 * spacing only, never the heading size, so adjacent panels read as one family.
 */
export function OperationalPanel({
  title,
  icon: Icon,
  count,
  countTone = "neutral",
  meta,
  href,
  hrefLabel = "View all",
  action,
  flush = false,
  density = "standard",
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  count?: number;
  countTone?: "neutral" | "danger";
  meta?: ReactNode;
  href?: string;
  hrefLabel?: string;
  action?: ReactNode;
  flush?: boolean;
  density?: "compact" | "standard";
  children: ReactNode;
  className?: string;
}) {
  const compact = density === "compact";
  return (
    <section
      aria-label={title}
      className={cx("min-w-0 overflow-hidden rounded-lg border border-border bg-surface", className)}
    >
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-2 border-b border-border",
          compact ? "min-h-10 px-3 py-1.5" : "min-h-12 px-4 py-2.5",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted" /> : null}
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          {count !== undefined && (
            <span
              className={cx(
                "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                countTone === "danger" ? "bg-danger/10 text-danger" : "bg-secondary text-muted",
              )}
            >
              {count}
            </span>
          )}
          {meta}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {href ? (
            <Link
              href={href}
              className={cx("text-xs font-medium text-accent-text hover:underline", FOCUS_RING)}
            >
              {hrefLabel} <span aria-hidden>›</span>
            </Link>
          ) : null}
        </div>
      </div>
      <div className={flush ? undefined : compact ? "p-3" : "p-4"}>{children}</div>
    </section>
  );
}

/**
 * Sibling views of one workspace, as links. The current view is marked by `aria-current`, a heavier
 * weight and an underline as well as colour, so selection never depends on colour alone.
 */
export function ViewNavigation({
  label,
  items,
  className,
}: {
  label: string;
  items: { key: string; label: string; href: string; current: boolean }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cx("flex gap-5 overflow-x-auto border-b border-border text-sm", className)}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 py-2",
            item.current
              ? "border-accent font-semibold text-foreground"
              : "border-transparent text-muted hover:text-foreground",
            FOCUS_RING,
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
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
            "h-9 min-w-20 max-w-28 justify-between gap-2 rounded-md px-3 text-xs font-normal shadow-none",
            className,
          )}
          aria-label={`${label}: ${options.find((o) => o.value === value)?.label ?? label}`}
        >
          {Icon && <Icon className="size-4 shrink-0 text-muted" />}
          <span className="truncate">
            {options.find((o) => o.value === value)?.label ?? label}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 rounded-md p-1.5">
        <fieldset>
          <legend className="px-2 py-1.5 text-xs font-semibold text-muted">
            {label}
          </legend>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-hover focus-within:bg-selected"
            >
              <input
                className="size-3.5 accent-[var(--accent)]"
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
        <AvatarFallback className="bg-secondary text-[10px] font-semibold text-muted">
          {name ? (
            name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0])
              .join("")
              .toUpperCase()
          ) : (
            <UserRound className="size-3 text-subtle" />
          )}
        </AvatarFallback>
      </Avatar>
      {!compact && (
        <span className={cx("truncate", !name && "text-muted")}>
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
  if (!value) return <span className="text-subtle">No target</span>;
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
              "inline-block whitespace-nowrap text-xs tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              overdue
                ? "text-danger"
                : deadline && active
                  ? "text-warning"
                  : "text-muted",
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
          "h-1.5 w-20 bg-secondary",
          percent >= 30
            ? "[&_[data-slot=progress-indicator]]:bg-danger"
            : percent >= 15
              ? "[&_[data-slot=progress-indicator]]:bg-warning"
              : percent > 0
                ? "[&_[data-slot=progress-indicator]]:bg-warning"
                : "[&_[data-slot=progress-indicator]]:bg-success",
        )}
      />
      <span
        className={cx(
          "w-7 text-right text-[11px] tabular-nums",
          percent >= 30 ? "text-danger" : "text-muted",
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
    tone: StatusTone;
    href: string;
  }[];
}) {
  return (
    <ol className="px-3.5 pb-2">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 py-2.5">
          {i < items.length - 1 && (
            <span
              className="absolute bottom-0 left-[5px] top-6 w-px bg-border"
              aria-hidden="true"
            />
          )}
          <span
            className={cx(
              "relative mt-1 size-[11px] shrink-0 rounded-full border-2 bg-background",
              item.tone === "success"
                ? "border-success"
                : item.tone === "danger"
                  ? "border-danger"
                  : item.tone === "warning"
                    ? "border-warning"
                    : "border-muted",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 border-b border-border pb-2">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={item.href}
                className={cx("truncate text-xs font-semibold hover:underline", FOCUS_RING)}
              >
                {item.title}
              </Link>
              <span className="shrink-0 text-[10px] text-muted">
                {item.time}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-4 text-muted">
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
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-start gap-2.5 rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-hover"
    >
      <IconWell icon={icon} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{title}</div>
        <p className="mt-1 text-[11px] leading-4 text-muted">
          {description}
        </p>
      </div>
      <ChevronRight className="mt-3 size-3.5 shrink-0 text-subtle" />
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
        <thead className="border-y border-border bg-secondary text-[11px] text-muted">
          <tr>
            {headings.map((h) => (
              <th key={h} className="h-8 whitespace-nowrap px-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&_td]:h-11 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-middle">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={headings.length}>
                <div className="flex min-h-64 items-center justify-center text-sm text-muted">
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
