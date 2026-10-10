"use client";

import { useId, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@gold/ui/components/popover";
import { Button } from "@/components/controls/button";
import { TextInput } from "@/components/controls/inputs";

/** Calendar dates stay in the caller's timezone; this control never converts them to instants. */
export function DateRangeFilter({
  from,
  to,
  timezone,
  onApply,
  label = "Reporting period",
}: {
  from: string;
  to: string;
  timezone: string;
  onApply: (range: { from: string; to: string }) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const id = useId();
  const format = (value: string) =>
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
  const valid = Boolean(start && end && start <= end);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setStart(from);
          setEnd(to);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          className="h-9 gap-2 rounded-md px-2.5 text-xs font-normal"
          aria-label={label}
        >
          <CalendarDays className="size-4 text-muted" aria-hidden="true" />
          {format(from)} – {format(to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-4">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-[11px] text-muted">{timezone}</p>
        <label className="grid gap-1 text-xs">
          From date
          <TextInput
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => setStart(e.target.value)}
            aria-describedby={!valid ? id : undefined}
          />
        </label>
        <label className="grid gap-1 text-xs">
          To date
          <TextInput
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            aria-describedby={!valid ? id : undefined}
          />
        </label>
        {!valid && (
          <p id={id} className="text-xs text-danger">
            Choose an end date on or after the start date.
          </p>
        )}
        <Button
          type="button"
          size="small"
          disabled={!valid}
          onClick={() => {
            onApply({ from: start, to: end });
            setOpen(false);
          }}
        >
          Set dates
        </Button>
      </PopoverContent>
    </Popover>
  );
}
