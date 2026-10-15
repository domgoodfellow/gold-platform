import type { Database, Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { SERVICE_KINDS, type ServiceKind } from './service-engagements';

export type DisclosureContent = {
  title: string; serviceKind: ServiceKind; summary: string; status: string;
  deliverables: { deliverableId: string; title: string; summary: string; status: string; shareLink: boolean }[];
};
export type ServiceDisclosure = Database['public']['Tables']['service_disclosures']['Row'];
export type DisclosureRevision = Database['public']['Tables']['service_disclosure_revisions']['Row'];
export type ApprovedDeliverable = { kind: string; title: string; summary: string; status: string; url: string | null };
export type ApprovedService = { id: string; title: string; serviceKind: ServiceKind; summary: string; status: string; publishedAt: string; deliverables: ApprovedDeliverable[] };

export function parseDisclosureContent(value: unknown): DisclosureContent {
  const keys = (v: unknown, names: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(name => Object.hasOwn(v, name));
  const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && !v.includes('\0') && !/[\uD800-\uDFFF]/u.test(v) && (empty || !!v.trim()) && Array.from(v).length <= max;
  const invalid = (): never => { throw new DomainError('Check the customer update title, description, progress and deliverables.', 'disclosure.invalid_content'); };
  if (!keys(value, ['title', 'serviceKind', 'summary', 'status', 'deliverables']) || !text(value.title, 200) || !text(value.summary, 3000) || !text(value.status, 200) || typeof value.serviceKind !== 'string' || !Object.hasOwn(SERVICE_KINDS, value.serviceKind) || !Array.isArray(value.deliverables) || value.deliverables.length > 20) return invalid();
  const ids = new Set<string>();
  for (const item of value.deliverables) {
    if (!keys(item, ['deliverableId', 'title', 'summary', 'status', 'shareLink']) || typeof item.deliverableId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.deliverableId) || ids.has(item.deliverableId) || !text(item.title, 200) || !text(item.summary, 1000, true) || !text(item.status, 200) || typeof item.shareLink !== 'boolean') return invalid();
    ids.add(item.deliverableId);
  }
  return value as unknown as DisclosureContent;
}

export async function disclosureEditorState(db: Db, organizationId: string, customerId: string, engagementId: string) {
  const [draft, history] = await Promise.all([
    db.from('service_disclosures').select('*').eq('organization_id', organizationId).eq('customer_id', customerId).eq('engagement_id', engagementId).maybeSingle(),
    db.from('service_disclosure_revisions').select('*').eq('organization_id', organizationId).eq('customer_id', customerId).eq('engagement_id', engagementId).order('number', { ascending: false }).limit(50),
  ]);
  if (draft.error || history.error) throw new DomainError('Customer updates could not be loaded.', 'disclosure.read_failed');
  return { disclosure: draft.data, history: history.data ?? [] };
}
export async function saveServiceDisclosure(db: Db, organizationId: string, customerId: string, engagementId: string, version: number, content: DisclosureContent) {
  const { data, error } = await db.rpc('save_service_disclosure', { p_organization_id: organizationId, p_customer_id: customerId, p_engagement_id: engagementId, p_expected_version: version, p_content: parseDisclosureContent(content) });
  if (error) throw new DomainError(error.message, 'disclosure.save_failed');
  return data;
}
export async function releaseServiceDisclosure(db: Db, organizationId: string, customerId: string, engagementId: string, version: number, operation: 'publish' | 'withdraw') {
  const { error } = await db.rpc(operation === 'publish' ? 'publish_service_disclosure' : 'withdraw_service_disclosure', { p_organization_id: organizationId, p_customer_id: customerId, p_engagement_id: engagementId, p_expected_version: version });
  if (error) throw new DomainError(error.message, `disclosure.${operation}_failed`);
}
export async function portalServiceDisclosures(db: Db, disclosureId?: string, limit = 100): Promise<ApprovedService[]> {
  const { data, error } = await db.rpc('portal_service_disclosures', { p_disclosure_id: disclosureId, p_limit: limit });
  if (error) throw new DomainError('Service updates are unavailable. Reload or contact the service organization.', 'disclosure.portal_unavailable');
  return data as unknown as ApprovedService[];
}
