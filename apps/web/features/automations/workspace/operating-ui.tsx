
export function AutomationState({ value }: { value: string }) {
  const color =
    value === 'failed' || value === 'uncertain'
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
