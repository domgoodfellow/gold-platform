import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';
import { classificationLabel } from '@/lib/domain/customers/classification';
import type { RelationshipActivity, RelationshipRow } from '@/lib/domain/contacts/relationship-activity';
export type CurrencyTotal = { currency: string; amount_minor: string };
export type CrmSummary = { customers: number; open: number; today: number; overdue: number; noNext: number; unassigned: number;
  forecast: CurrencyTotal[]; pipeline: CurrencyTotal[]; won: number; lost: number };
export async function crmDashboardSummary(db: Db, organizationId: string, month: string): Promise<CrmSummary> {
  const { data, error } = await db.rpc('crm_dashboard_summary', { p_organization_id: organizationId, p_month: month });
  if (error) throw fromDatabaseError(error, 'crm.summary_failed');
  return data as unknown as CrmSummary;
}
export function winRate(won: number, lost: number): number | null { return won + lost ? won / (won + lost) : null; }

/**
 * How the Opportunities & Pipeline section is composed. No catalogue feature governs opportunities
 * today (CRM's Pipeline destination is ungated), so entitlement is the CRM workspace itself; data
 * state and permission decide the rest. A business with no stages and no opportunities sees setup
 * guidance only when the viewer may configure stages, and otherwise no sales section at all.
 */
export type SalesComposition = 'full' | 'setup' | 'hidden';
export function salesComposition(input: { entitled: boolean; hasStages: boolean; hasOpportunities: boolean; mayConfigureStages: boolean }): SalesComposition {
  if (!input.entitled) return 'hidden';
  if (input.hasStages || input.hasOpportunities) return 'full';
  return input.mayConfigureStages ? 'setup' : 'hidden';
}

const TASK_DONE: Record<string, string> = { call: 'Call task completed', email: 'Email task completed', meeting: 'Meeting task completed', task: 'Task completed' };
const CALL_ENDED: Record<string, string> = { no_answer: 'Call not answered', busy: 'Call attempted: line busy', failed: 'Call attempted: did not connect' };
/**
 * One plain sentence for a qualifying relationship event; only the actions the read admits. A placed
 * call is an attempt until its end is recorded as completed; a completed task says a task was marked
 * done, not that a conversation happened; opportunity events say the opportunity moved.
 */
export function relationshipActivityLabel(activity: RelationshipActivity): string {
  const { detail } = activity;
  switch (activity.action) {
    case 'call.placed': return detail.direction === 'inbound' ? 'Incoming call' : 'Call attempted';
    case 'call.ended': {
      if (detail.status !== 'completed') return CALL_ENDED[detail.status] ?? 'Call ended';
      const minutes = Number(detail.duration) > 0 ? Math.max(1, Math.round(Number(detail.duration) / 60)) : null;
      return minutes ? `Call completed (${minutes} min)` : 'Call completed';
    }
    case 'call.wrapped_up': return 'Call notes recorded';
    case 'follow_up.completed': return `${TASK_DONE[detail.kind] ?? 'Task completed'}${detail.title ? `: ${detail.title}` : ''}`;
    case 'customer.classification_changed': return detail.to_lifecycle ? `Lifecycle changed to ${classificationLabel(detail.to_lifecycle).toLowerCase()}` : 'Lifecycle cleared';
    case 'customer.stage_changed': return 'Relationship stage changed';
    case 'opportunity.created': return `Opportunity opened${detail.title ? `: ${detail.title}` : ''}`;
    case 'opportunity.stage_changed': return `Opportunity ${detail.title ?? ''} moved to ${detail.stage_name ?? 'Unstaged'}`.replace('  ', ' ');
    default: return 'Relationship activity';
  }
}

export type CompanyGroup = { companyId: string | null; companyName: string | null; company: RelationshipRow | null; people: RelationshipRow[] };
/**
 * Groups the displayed rows under companies without changing who owns what: a company row heads its
 * own group, a person sits under their primary active company (one, so never twice), and people with
 * no company stay in a final group. Groups keep the order of their most recent member.
 */
export function groupRelationshipsByCompany(rows: readonly RelationshipRow[]): CompanyGroup[] {
  const groups = new Map<string, CompanyGroup>(); const unaffiliated: CompanyGroup = { companyId: null, companyName: null, company: null, people: [] };
  for (const row of rows) {
    const key = row.contactType === 'company' ? row.id : row.companyId;
    if (!key) { unaffiliated.people.push(row); continue; }
    const group = groups.get(key) ?? { companyId: key, companyName: row.contactType === 'company' ? row.name : row.companyName, company: null, people: [] };
    if (row.contactType === 'company') { group.company = row; group.companyName = row.name; } else group.people.push(row);
    groups.set(key, group);
  }
  return [...groups.values(), ...(unaffiliated.people.length ? [unaffiliated] : [])];
}
