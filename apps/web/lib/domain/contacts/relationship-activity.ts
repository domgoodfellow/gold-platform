import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';
import type { ContactLifecycle } from '../customers/classification';
import type { ContactType } from './contacts';

export type RelationshipOverview = {
  total: number; people: number; companies: number; unspecified: number; newLast30Days: number;
  lifecycles: Record<ContactLifecycle | 'unclassified', number>;
};

/** Exact counts over the whole directory: identity type and lifecycle are separate dimensions. */
export async function relationshipOverview(db: Db, organizationId: string): Promise<RelationshipOverview> {
  const { data, error } = await db.rpc('crm_relationship_overview', { p_organization_id: organizationId });
  if (error) throw fromDatabaseError(error, 'crm.overview_failed');
  const row = data as Record<string, number>;
  return { total: row.total, people: row.people, companies: row.companies, unspecified: row.unspecified, newLast30Days: row.newLast30Days,
    lifecycles: { lead: row.lead, prospect: row.prospect, customer: row.customer, unclassified: row.unclassified } };
}

export type RelationshipActivity = { action: string; detail: Record<string, string>; occurredAt: string };
export type RelationshipRow = {
  id: string; name: string; contactType: ContactType; lifecycle: ContactLifecycle | null;
  /** A person's primary active company affiliation; always null for companies and unaffiliated people. */
  companyId: string | null; companyName: string | null;
  /** Null only in the Recently added fallback, which never claims an interaction. */
  activity: RelationshipActivity | null;
  createdAt?: string;
  nextTask: { id: string; title: string; dueAt: string } | null;
};

/**
 * Contacts ordered by their latest qualifying relationship event (see the
 * `crm_recent_relationships` migration for what qualifies), one row per contact, bounded.
 * The next task is read in the same statement only when the caller says tasks are available.
 */
export async function listRecentRelationships(db: Db, input: { organizationId: string; limit?: number; includeNextTask: boolean }): Promise<RelationshipRow[]> {
  const { data, error } = await db.rpc('crm_recent_relationships', { p_organization_id: input.organizationId, p_limit: input.limit ?? 8, p_include_next: input.includeNextTask });
  if (error) throw fromDatabaseError(error, 'crm.recent_relationships_failed');
  return (data ?? []).map(row => ({
    id: row.contact_id, name: row.name, contactType: row.contact_type as ContactType, lifecycle: row.lifecycle as ContactLifecycle | null,
    companyId: row.company_id, companyName: row.company_name,
    activity: { action: row.action, detail: (row.detail ?? {}) as Record<string, string>, occurredAt: row.occurred_at },
    nextTask: row.next_task_id ? { id: row.next_task_id, title: row.next_task_title, dueAt: row.next_task_due_at } : null,
  }));
}

/** The fallback when nothing qualifying has been recorded: newest records, labelled as additions. */
export async function listRecentlyAddedContacts(db: Db, input: { organizationId: string; limit?: number }): Promise<RelationshipRow[]> {
  const { data, error } = await db.from('contact_directory')
    .select('id, name, contact_type, lifecycle, directory_company_id, directory_company_name, created_at')
    .eq('organization_id', input.organizationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(input.limit ?? 8);
  if (error) throw fromDatabaseError(error, 'crm.recent_contacts_failed');
  return (data ?? []).map(row => ({
    id: row.id!, name: row.name!, contactType: row.contact_type as ContactType, lifecycle: row.lifecycle as ContactLifecycle | null,
    companyId: row.contact_type === 'person' ? row.directory_company_id : null, companyName: row.contact_type === 'person' ? row.directory_company_name : null,
    activity: null, createdAt: row.created_at!, nextTask: null,
  }));
}
