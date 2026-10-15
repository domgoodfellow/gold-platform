'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { endClientTenantRelationship, linkExistingTenant, listExistingTenantOptions } from '@/lib/domain/customers/client-tenants';
import { DomainError } from '@/lib/domain/errors';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { getCustomer } from '@/lib/domain/customers/customers';
import { disclosureEditorState, parseDisclosureContent, releaseServiceDisclosure, saveServiceDisclosure } from '@/lib/domain/customers/service-disclosures';
import type { ApprovedDeliverable } from '@/lib/domain/customers/service-disclosures';
import { SERVICE_KINDS, ARTIFACT_KINDS, createServiceEngagement, getServiceEngagement, transitionServiceEngagement, bindServiceEngagementTenant, attachEngagementDeliverable, attachEngagementWork, listDeliverableOptions, listEngagementDeliverables, type ServiceKind, type ArtifactKind } from '@/lib/domain/customers/service-engagements';

export type ServiceActionState = { error: string | null; saved: boolean };

export async function searchExistingClientTenants(organizationId: string, customerId: string, search: string) {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('customer.update') || !await isPlatformStaff(db) || !await getCustomer(db, { organizationId, customerId })) {
    throw new DomainError('Verified customer-management authority required.', 'client_tenant.forbidden');
  }
  return listExistingTenantOptions(db, organizationId, customerId, search.trim().slice(0, 100));
}

export async function engagementAction(_previous: ServiceActionState, form: FormData): Promise<ServiceActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const customerId = String(form.get('customerId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    const operation = String(form.get('operation') ?? '');
    if (operation === 'create') {
      const kind = String(form.get('serviceKind') ?? '');
      if (!Object.hasOwn(SERVICE_KINDS, kind)) throw new DomainError('Choose a supported service.', 'engagement.invalid_kind');
      await createServiceEngagement(db, { organizationId, customerId, name: String(form.get('name') ?? ''), serviceKind: kind as ServiceKind, relationshipId: String(form.get('relationshipId') ?? '') || undefined, opportunityId: String(form.get('opportunityId') ?? '') || undefined, proposalId: String(form.get('proposalId') ?? '') || undefined });
    } else {
      const engagementId = String(form.get('engagementId') ?? '');
      if (!await getServiceEngagement(db, organizationId, customerId, engagementId)) throw new DomainError('Engagement unavailable.', 'engagement.unavailable');
      if (operation === 'transition') {
        const status = String(form.get('status') ?? '');
        if (status !== 'active' && status !== 'completed' && status !== 'cancelled') throw new DomainError('Unsupported status.', 'engagement.invalid_status');
        await transitionServiceEngagement(db, organizationId, engagementId, status);
      } else if (operation === 'attach') {
        const [kind, artifactId] = String(form.get('artifact') ?? '').split(':');
        if (!Object.hasOwn(ARTIFACT_KINDS, kind)) throw new DomainError('Choose a supported artifact.', 'engagement.invalid_kind');
        await attachEngagementDeliverable(db, organizationId, engagementId, kind as ArtifactKind, artifactId);
      } else if (operation === 'work') {
        await attachEngagementWork(db, organizationId, engagementId, String(form.get('workItemId') ?? ''));
      } else if (operation === 'bind') {
        await bindServiceEngagementTenant(db, organizationId, engagementId, String(form.get('relationshipId') ?? ''));
      } else throw new DomainError('Unsupported operation.', 'engagement.invalid_operation');
    }
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, saved: true };
}

export async function readEngagementDetails(organizationId: string, customerId: string, engagementId: string, search = '') {
  const { db, organization } = await requireOrganization(organizationId);
  const engagement = await getServiceEngagement(db, organizationId, customerId, engagementId);
  if (!engagement) throw new DomainError('Engagement unavailable.', 'engagement.unavailable');
  const [deliverables, options, work] = await Promise.all([
    listEngagementDeliverables(db, organizationId, engagementId),
    listDeliverableOptions(db, organizationId, engagementId, search),
    db.from('engagement_work_items').select('work_item_id').eq('organization_id', organizationId).eq('engagement_id', engagementId),
  ]);
  if (work.error) throw new DomainError(work.error.message, 'engagement.work_failed');
  const updates = await disclosureEditorState(db, organizationId, customerId, engagementId);
  const customer = await getCustomer(db, { organizationId, customerId });
  const relationship = engagement.relationship_id ? await db.from('client_tenant_relationships').select('status').eq('organization_id', organizationId).eq('id', engagement.relationship_id).maybeSingle() : null;
  if (relationship?.error) throw new DomainError('Relationship could not be loaded.', 'disclosure.read_failed');
  let approvedDeliverables: ApprovedDeliverable[] = [];
  if (updates.disclosure?.published_revision_id && relationship?.data?.status === 'active') {
    const { data, error } = await db.from('service_disclosure_deliverables').select('kind,title,summary,status,url').eq('organization_id', organizationId).eq('revision_id', updates.disclosure.published_revision_id).order('position');
    if (error) throw new DomainError('Approved deliverables could not be loaded.', 'disclosure.read_failed');
    approvedDeliverables = await Promise.all((data ?? []).map(async item => {
      if (!item.url) return item;
      const { data: binding, error: bindingError } = await db.rpc('hostname_binding', { p_hostname: new URL(item.url).hostname });
      return { ...item, url: !bindingError && binding?.some(host => host.organization_id === engagement.tenant_organization_id) ? item.url : null };
    }));
  }
  return { deliverables, options, workIds: (work.data ?? []).map(item => item.work_item_id), ...updates, approvedDeliverables, customerName: customer?.name ?? 'Customer', organizationName: organization.name, timezone: organization.timezone, mayReadSupport: organization.capabilities.includes('support.read') };
}

export async function disclosureAction(_previous: ServiceActionState, form: FormData): Promise<ServiceActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const customerId = String(form.get('customerId') ?? '');
  const engagementId = String(form.get('engagementId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    const operation = String(form.get('operation') ?? '');
    const version = Number(form.get('version'));
    if (!Number.isInteger(version) || version < 0) throw new DomainError('Reload the customer update.', 'disclosure.invalid_version');
    if (operation === 'save') {
      let value: unknown;
      try { value = JSON.parse(String(form.get('content') ?? '')); } catch { throw new DomainError('Invalid customer update.', 'disclosure.invalid_content'); }
      await saveServiceDisclosure(db, organizationId, customerId, engagementId, version, parseDisclosureContent(value));
    } else if (operation === 'publish' || operation === 'withdraw') {
      await releaseServiceDisclosure(db, organizationId, customerId, engagementId, version, operation);
    } else throw new DomainError('Unsupported customer update operation.', 'disclosure.invalid_operation');
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  revalidatePath('/portal', 'layout');
  return { error: null, saved: true };
}

export async function relationshipAction(_previous: ServiceActionState, form: FormData): Promise<ServiceActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const customerId = String(form.get('customerId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    if (form.get('operation') === 'end') {
      const relationshipId = String(form.get('relationshipId') ?? '');
      const { data, error } = await db.from('client_tenant_relationships').select('id').eq('organization_id', organizationId).eq('customer_id', customerId).eq('id', relationshipId).maybeSingle();
      if (error || !data) throw new DomainError('Relationship unavailable.', 'client_tenant.unavailable');
      await endClientTenantRelationship(db, organizationId, relationshipId);
    } else if (form.get('operation') === 'link') {
      await linkExistingTenant(db, { organizationId, customerId, tenantId: String(form.get('tenantId') ?? ''), authorityBasis: String(form.get('authorityBasis') ?? '') });
    } else throw new DomainError('Unsupported operation.', 'client_tenant.invalid_operation');
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/customers/${customerId}`);
  return { error: null, saved: true };
}
