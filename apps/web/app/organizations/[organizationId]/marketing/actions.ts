'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import type { Json } from '@/lib/db/database.types';
import { commandMarketing, readMarketing, type InquiryDetail } from '@/lib/domain/marketing/marketing';

export async function marketingCommandAction(organizationId: string, command: string, input: Record<string, Json | undefined>) {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('marketing.manage')) return { error: 'Marketing management permission required.', id: null };
  try {
    const id = await commandMarketing(db, organizationId, command, input);
    revalidatePath(`/organizations/${organizationId}/marketing`, 'layout');
    revalidatePath(`/organizations/${organizationId}/customers`);
    return { id, error: null };
  } catch (error) { return { id: null, error: error instanceof Error ? error.message : 'The change could not be saved.' }; }
}

export async function inspectInquiryAction(organizationId: string, id: string) {
  const { db } = await requireOrganization(organizationId);
  return readMarketing<InquiryDetail | null>(db, organizationId, 'inquiry', { id });
}

export async function previewAudienceAction(organizationId: string, id: string) {
  const { db } = await requireOrganization(organizationId);
  return readMarketing<{ total: number; customers: { id: string; name: string; created_at: string }[] }>(db, organizationId, 'audience', { id });
}

export async function searchMarketingCustomersAction(organizationId: string, q: string) {
  const { db } = await requireOrganization(organizationId);
  return readMarketing<{ id: string; name: string; email: string | null; phone: string | null }[]>(db, organizationId, 'customers', { q });
}
