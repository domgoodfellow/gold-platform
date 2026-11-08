import type { FormDefinition } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import type { Json } from '@/lib/db/database.types';
import { fromDatabaseError } from '@/lib/domain/errors';

export const OBJECTIVES = { lead_generation: 'Lead generation', engagement: 'Form engagement', reengagement: 'Customer re-engagement', awareness: 'General awareness' } as const;
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = { draft: ['active', 'archived'], active: ['paused', 'completed', 'archived'], paused: ['active', 'completed', 'archived'], completed: ['archived'], archived: [] };
export type Campaign = {
  id: string; name: string; objective: keyof typeof OBJECTIVES; description: string; status: CampaignStatus;
  planned_start_on: string | null; planned_end_on: string | null; owner_membership_id: string | null; owner_name: string | null;
  channels: string[]; leads: number; handoffs: number; created_at: string;
  landing_page_id: string | null; landing_page: { name: string; slug: string } | null;
  audiences: { id: string; name: string }[];
  forms: { id: string; name: string; public_key: string; published: boolean; token: string }[];
};
export type Audience = { id: string; name: string; description: string; stage_id: string | null; stage_name: string | null; created_from: string | null; created_before: string | null; matching: number };
export type Inquiry = {
  id: string; campaign_id: string | null; campaign_name_at_capture: string | null; form_id: string; form_name_at_capture: string;
  submission_id: string; source: string; source_context: Record<string, string>; occurred_at: string;
  status: 'new' | 'in_review' | 'handed_off' | 'disqualified'; customer_id: string | null; customer_name: string | null; reviewed_by: string | null;
};
export type InquiryDetail = Inquiry & { answers: Record<string, unknown>; definition: FormDefinition };
export type MarketingData = {
  attention: { active: Campaign[]; setup: Campaign[]; ending: Campaign[]; new: Inquiry[]; in_review: Inquiry[] };
  campaigns: Campaign[]; campaign_total: number; inquiries: Inquiry[]; inquiry_total: number; audiences: Audience[]; audience_total: number;
  summary: { active: number; active_in_period: number; acquired: number; attributed: number; cohort_handoffs: number; handoffs: number; awaiting: number; submissions: number };
  sources: { source: string; medium: string; form: string; campaign: string | null; acquired: number; handoffs: number }[];
  trend: { day: string; acquired: number; handoffs: number }[];
  events: { id: string; entity_type: string; entity_id: string; action: string; occurred_at: string; payload: Record<string, string> }[];
  members: { id: string; name: string }[]; stages: { id: string; name: string }[];
  available_forms: { id: string; name: string; public_key: string; published: boolean }[];
  available_pages: { id: string; name: string; site: string; revision: string }[];
  public_hostname: string | null;
  campaign_options: { id: string; name: string }[]; period: { from: string; to: string; from_date: string; to_date: string };
};

export async function readMarketing<T = MarketingData>(db: Db, organizationId: string, view: string, filters: Record<string, string> = {}): Promise<T> {
  const { data, error } = await db.rpc('marketing_read', { p_organization_id: organizationId, p_view: view, p_filters: filters });
  if (error) throw fromDatabaseError(error, 'marketing.read_failed');
  return data as unknown as T;
}

export async function commandMarketing(db: Db, organizationId: string, command: string, input: Record<string, Json | undefined>): Promise<string> {
  const { data, error } = await db.rpc('marketing_command', { p_organization_id: organizationId, p_command: command, p_input: input });
  if (error) throw fromDatabaseError(error, 'marketing.write_failed');
  return data;
}
