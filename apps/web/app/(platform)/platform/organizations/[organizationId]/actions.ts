'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { bootstrapGoldInternalWorkspace } from '@/lib/domain/tenancy/gold-internal';
import { revalidatePath } from 'next/cache';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { recordProviderResource, setProviderResourceStatus } from '@/lib/domain/providers/bindings';
import { provisionTelephonySubaccount } from '@/lib/domain/providers/twilio-provisioning';
import { endSupportSession, startSupportSession } from '@/lib/domain/platform/support';
import { TELEPHONY_RESOURCE_TYPES, telephonyProviderKey } from '@/lib/adapters/telephony';
import type { ProvisionTwilioState, RegisterResourceState, SetResourceStatusState, SupportSessionState, RecordTermState, RecordPlanAssignmentState } from './action-states';


async function attempt<T extends { error: string | null }>(operation: () => Promise<void>, success: Omit<T, 'error'>, path: string): Promise<T> { try { await operation(); revalidatePath(path); return { ...success, error: null } as T; } catch (error) { return { ...success, error: error instanceof Error ? error.message : 'Unable to record change.' } as T; } }
export async function provisionTwilioAction(_: ProvisionTwilioState, f: FormData): Promise<ProvisionTwilioState> { const id = String(f.get('organizationId') ?? ''); return attempt<ProvisionTwilioState>(async () => { const db = await getDb(); await provisionTelephonySubaccount(db, { organizationId: id }); }, { provisioned: true }, `/platform/organizations/${id}`); }
export async function registerPhoneNumberAction(_: RegisterResourceState, f: FormData): Promise<RegisterResourceState> { const id = String(f.get('organizationId') ?? ''); return attempt<RegisterResourceState>(async () => { const db = await getDb(); await recordProviderResource(db, { organizationId: id, providerKey: telephonyProviderKey(), resourceType: TELEPHONY_RESOURCE_TYPES.phoneNumber, externalId: String(f.get('number') ?? '').trim() }); }, { recorded: true }, `/platform/organizations/${id}`); }
export async function setResourceStatusAction(_: SetResourceStatusState, f: FormData): Promise<SetResourceStatusState> { const id = String(f.get('organizationId') ?? ''); return attempt<SetResourceStatusState>(async () => { const db = await getDb(); await setProviderResourceStatus(db, { organizationId: id, resourceId: String(f.get('resourceId') ?? ''), status: String(f.get('status') ?? '') as 'pending', error: String(f.get('errorDetail') ?? '') || null }); }, { recorded: true }, `/platform/organizations/${id}`); }
export async function startSupportSessionAction(_: SupportSessionState, f: FormData) { const id = String(f.get('organizationId') ?? ''); return attempt(async () => { const db = await getDb(); await startSupportSession(db, { organizationId: id, reason: String(f.get('reason') ?? '') || undefined }); }, {}, `/platform/organizations/${id}`); }
export async function endSupportSessionAction(_: SupportSessionState, f: FormData) { const id = String(f.get('organizationId') ?? ''); return attempt(async () => { const db = await getDb(); await endSupportSession(db, { id: String(f.get('sessionId') ?? '') }); }, {}, `/platform/organizations/${id}`); }
export async function recordCommercialTermAction(_: RecordTermState, f: FormData): Promise<RecordTermState> { const id = String(f.get('organizationId') ?? ''); return attempt<RecordTermState>(async () => { const db = await getDb(); await recordCommercialTerm(db, { organizationId: id, productKey: String(f.get('productKey') ?? ''), periodStart: String(f.get('periodStart') ?? ''), periodEnd: String(f.get('periodEnd') ?? ''), priceMinor: Number(f.get('priceMinor') ?? 0), currency: String(f.get('currency') ?? '') || undefined }); }, { recorded: true }, `/platform/organizations/${id}`); }
export async function recordPlanAssignmentAction(_: RecordPlanAssignmentState, f: FormData): Promise<RecordPlanAssignmentState> { const id = String(f.get('organizationId') ?? ''); return attempt<RecordPlanAssignmentState>(async () => { const db = await getDb(); await recordPlanAssignment(db, { organizationId: id, planId: String(f.get('planId') ?? ''), periodStart: String(f.get('periodStart') ?? ''), periodEnd: String(f.get('periodEnd') ?? ''), note: String(f.get('note') ?? '') }); }, { recorded: true }, `/platform/organizations/${id}/commercial`); }

/** Explicit operator bootstrap: membership + no current plan + no existing GOLD workspace. */
export async function initializeGoldWorkspaceAction(organizationId: string) {
  const db = await getDb();
  await bootstrapGoldInternalWorkspace(db, { organizationId });
  redirect(`/organizations/${organizationId}`);
}
