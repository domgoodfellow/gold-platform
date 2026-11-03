"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@gold/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@gold/ui/components/tooltip";
import { Button } from "@/components/controls/button";
import { cx } from "@/components/class-names";

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
              "inline-block whitespace-nowrap text-xs tabular-nums",
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

