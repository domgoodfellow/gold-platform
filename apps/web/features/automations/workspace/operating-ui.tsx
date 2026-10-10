import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function AutomationPanel({
  title,
  href,
  children,
  note,
}: {
  title: string;
  href?: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="flex items-center text-xs text-accent-text hover:underline"
          >
            View all <ChevronRight className="size-3" />
          </Link>
        ) : (
          note
        )}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}
export function AutomationState({ value }: { value: string }) {
  const color =
    value === 'failed'
      ? 'bg-danger/10 text-danger'
      : value === 'done' || value === 'sent' || value === 'Enabled'
        ? 'bg-success/10 text-success'
        : 'bg-secondary text-subtle';
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}
    >
      {value === 'done' ? 'Completed' : value === 'failed' ? 'Failed' : value}
    </span>
  );
}
export function automationTime(at: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}
export function automationDiagnostic(detail: string | null) {
  if (!detail) return 'No diagnostic recorded';
  if (/may not move from status|status transition/i.test(detail))
    return 'Work status transition refused. Review the allowed lifecycle transitions.';
  if (/overlap|exclusion constraint/i.test(detail))
    return 'Scheduling conflict. The proposed change overlaps an existing commitment.';
  if (/customer.*(missing|no|not)|no customer/i.test(detail))
    return 'Customer context is missing. Attach a Customer or add a Customer condition.';
  return detail;
}
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border px-4 py-5 text-center text-xs text-subtle">
      {children}
    </p>
  );
}
