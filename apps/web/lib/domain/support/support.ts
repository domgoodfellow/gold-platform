import type { Db } from "@/lib/db/types";
import type { Json } from "@/lib/db/database.types";
import { DomainError } from "@/lib/domain/errors";

export const STATUSES = [
  "new",
  "open",
  "waiting",
  "resolved",
  "closed",
] as const;
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type CaseStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  new: ["open", "waiting"],
  open: ["waiting"],
  waiting: ["open"],
  resolved: [],
  closed: [],
};
export type SupportCase = {
  id: string;
  case_number: string;
  title: string;
  description: string;
  status: CaseStatus;
  priority: Priority;
  customer_id: string | null;
  customer_name: string | null;
  queue_id: string | null;
  queue_name: string | null;
  assigned_membership_id: string | null;
  owner_name: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_summary: string | null;
  escalated_at: string | null;
  resolution_due_at: string | null;
  target_snapshot: {
    name: string;
    priority: string;
    minutes: number;
    clock: string;
    applied_at: string;
  } | null;
};
export type Queue = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  open_count: number;
  overdue_count: number;
  created_count: number;
  resolved_count: number;
};
export type Policy = {
  id: string;
  name: string;
  priority: Priority;
  queue_id: string | null;
  target_minutes: number;
  active: boolean;
  clock_basis: "elapsed";
};
export type CaseEvent = {
  id: string;
  case_id: string;
  case_number: string;
  title: string;
  actor_name: string;
  kind: string;
  body: string;
  occurred_at: string;
  previous_value: SupportCase | null;
  new_value: SupportCase;
};
export type RecordKind =
  | "customer"
  | "conversation"
  | "call"
  | "work_item"
  | "invoice"
  | "asset"
  | "location";
export type RecordOption = { id: string; name: string; kind: RecordKind };
export type SupportData = {
  cases: SupportCase[];
  total: number;
  selected: SupportCase | null;
  board: { status: CaseStatus; count: number; cases: SupportCase[] }[];
  summary: {
    open: number;
    unassigned: number;
    overdue: number;
    urgent: number;
    resolved: number;
    created: number;
    due_today: number;
    assigned_today: number;
    resolved_today: number;
    unqueued: number;
    unqueued_created: number;
    unqueued_resolved: number;
    near_due: number;
    targeted_resolved: number;
    met_target: number;
    resolution_hours: number | null;
  };
  attention: Record<
    "unassigned" | "overdue" | "urgent" | "escalated",
    SupportCase[]
  >;
  queues: Queue[];
  policies: Policy[];
  members: { id: string; name: string }[];
  events: CaseEvent[];
  event_total: number;
  links: {
    id: string;
    kind: RecordKind;
    record_id: string;
    label: string;
    invoice_work_item_id: string | null;
  }[];
  trend: { day: string; created: number; resolved: number }[];
  priorities: { priority: Priority; count: number; created: number }[];
  period: { from: string; to: string };
};
export async function readSupport<T = SupportData>(
  db: Db,
  organizationId: string,
  view: string,
  filters: Record<string, string> = {},
): Promise<T> {
  const { data, error } = await db.rpc("support_read", {
    p_organization_id: organizationId,
    p_view: view,
    p_filters: filters,
  });
  if (error) throw new DomainError(error.message, "support.read_failed");
  return data as unknown as T;
}
export async function commandSupport(
  db: Db,
  organizationId: string,
  command: string,
  input: Record<string, Json | undefined>,
): Promise<string> {
  const { data, error } = await db.rpc("support_command", {
    p_organization_id: organizationId,
    p_command: command,
    p_input: input,
  });
  if (error) throw new DomainError(error.message, "support.write_failed");
  return data;
}
export function recordHref(
  organizationId: string,
  kind: RecordKind,
  id: string,
) {
  if (kind === "invoice")
    return `/organizations/${organizationId}/finance/invoices?q=${id}`;
  const paths: Record<RecordKind, string> = {
    customer: "customers",
    conversation: "comms/inbox",
    call: "calls",
    work_item: "work",
    invoice: "finance/invoices",
    asset: "assets",
    location: "locations",
  };
  return `/organizations/${organizationId}/${paths[kind]}/${id}`;
}

export type QueueConfiguration = Pick<Queue, 'id' | 'name' | 'description' | 'active'>;
export type SupportConfiguration = { queues: QueueConfiguration[]; policies: Policy[] };
export async function readSupportConfiguration(db: Db, organizationId: string): Promise<SupportConfiguration> {
 const [queues, policies] = await Promise.all([
  db.from('support_queues').select('id,name,description,active').eq('organization_id', organizationId).order('name'),
  db.from('support_service_levels').select('id,name,priority,queue_id,target_minutes,active,clock_basis').eq('organization_id', organizationId).order('name'),
 ]);
 if (queues.error || policies.error) throw new DomainError((queues.error ?? policies.error)!.message, 'support.configuration_read_failed');
 return { queues: queues.data ?? [], policies: (policies.data ?? []) as Policy[] };
}
