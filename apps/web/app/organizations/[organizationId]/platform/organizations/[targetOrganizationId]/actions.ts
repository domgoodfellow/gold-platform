'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { recordPlanAgreement, recordPlanAssignment, recordPlanQuotaOverride } from '@/lib/domain/catalogue/organization-plans';
import { bootstrapGoldInternalWorkspace } from '@/lib/domain/tenancy/gold-internal';
import { requirePlatformCapability, revalidatePlatform } from '@/lib/route/platform';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { recordProviderResource, setProviderResourceStatus } from '@/lib/domain/providers/bindings';
import { provisionTelephonySubaccount } from '@/lib/domain/providers/twilio-provisioning';
import { endSupportSession, startSupportSession } from '@/lib/domain/platform/support';
import { TELEPHONY_RESOURCE_TYPES, telephonyProviderKey } from '@/lib/adapters/telephony';
import type { ProvisionTwilioState, RegisterResourceState, SetResourceStatusState, SupportSessionState, RecordTermState, RecordPlanAssignmentState, RecordPlanAgreementState, RecordQuotaOverrideState } from './action-states';


/**
 * **The commercial writes below each prove `platform.commercial` on the server first.** The
 * screen hides their controls from a caller whose `platform_staff` row does not name it, which is
 * courtesy; `requirePlatformCapability` is the boundary, and `app.require_platform_capability`
 * inside each RPC is the second one. Neither reads the organization id out of the form: a `goldId`
 * a form supplied is a parameter the caller chose (D17), so GildOps' own organization is resolved
 * from the caller's own memberships instead.
 */
async function attempt<T extends { error: string | null }>(operation: () => Promise<void>, success: Omit<T, 'error'>): Promise<T> { try { await operation(); revalidatePlatform(); return { ...success, error: null } as T; } catch (error) { return { ...success, error: error instanceof Error ? error.message : 'Unable to record change.' } as T; } }
export async function provisionTwilioAction(_: ProvisionTwilioState, f: FormData): Promise<ProvisionTwilioState> { const id = String(f.get('organizationId') ?? ''); const result = await attempt<ProvisionTwilioState>(async () => { const db = await getDb(); await provisionTelephonySubaccount(db, { organizationId: id }); }, { provisioned: true }); return result; }
export async function registerPhoneNumberAction(_: RegisterResourceState, f: FormData): Promise<RegisterResourceState> { const id = String(f.get('organizationId') ?? ''); return attempt<RegisterResourceState>(async () => { const db = await getDb(); await recordProviderResource(db, { organizationId: id, providerKey: telephonyProviderKey(), resourceType: TELEPHONY_RESOURCE_TYPES.phoneNumber, externalId: String(f.get('number') ?? '').trim() }); }, { recorded: true }); }
export async function setResourceStatusAction(_: SetResourceStatusState, f: FormData): Promise<SetResourceStatusState> { const id = String(f.get('organizationId') ?? ''); return attempt<SetResourceStatusState>(async () => { const db = await getDb(); await setProviderResourceStatus(db, { organizationId: id, resourceId: String(f.get('resourceId') ?? ''), status: String(f.get('status') ?? '') as 'pending', error: String(f.get('errorDetail') ?? '') || null }); }, { recorded: true }); }
export async function startSupportSessionAction(_: SupportSessionState, f: FormData) { const id = String(f.get('organizationId') ?? ''); return attempt(async () => { const db = await getDb(); await startSupportSession(db, { organizationId: id, reason: String(f.get('reason') ?? '') || undefined }); }, {}); }
export async function endSupportSessionAction(_: SupportSessionState, f: FormData) { return attempt(async () => { const db = await getDb(); await endSupportSession(db, { id: String(f.get('sessionId') ?? '') }); }, {}); }
export async function recordCommercialTermAction(_: RecordTermState, f: FormData): Promise<RecordTermState> { const id = String(f.get('organizationId') ?? ''); return attempt<RecordTermState>(async () => { await requirePlatformCapability('platform.commercial'); const db = await getDb(); await recordCommercialTerm(db, { organizationId: id, productKey: String(f.get('productKey') ?? ''), periodStart: String(f.get('periodStart') ?? ''), periodEnd: String(f.get('periodEnd') ?? ''), priceMinor: Number(f.get('priceMinor') ?? 0), currency: String(f.get('currency') ?? '') || undefined }); }, { recorded: true }); }
export async function recordPlanAssignmentAction(_: RecordPlanAssignmentState, f: FormData): Promise<RecordPlanAssignmentState> { const id = String(f.get('organizationId') ?? ''); return attempt<RecordPlanAssignmentState>(async () => { await requirePlatformCapability('platform.commercial'); const db = await getDb(); await recordPlanAssignment(db, { organizationId: id, planId: String(f.get('planId') ?? ''), periodStart: String(f.get('periodStart') ?? ''), periodEnd: String(f.get('periodEnd') ?? ''), note: String(f.get('note') ?? '') }); }, { recorded: true }); }
export async function recordPlanAgreementAction(_: RecordPlanAgreementState, f: FormData): Promise<RecordPlanAgreementState> { const id = String(f.get('organizationId') ?? ''); const effectiveTo = String(f.get('effectiveTo') ?? '').trim(); return attempt<RecordPlanAgreementState>(async () => { await requirePlatformCapability('platform.commercial'); const db = await getDb(); await recordPlanAgreement(db, { organizationId: id, planId: String(f.get('planId') ?? ''), currency: String(f.get('currency') ?? ''), amountMinor: Math.round(Number(f.get('amount') ?? 0) * 100), effectiveFrom: new Date(String(f.get('effectiveFrom') ?? '')).toISOString(), effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null, note: String(f.get('note') ?? '') }); }, { recorded: true }); }
export async function recordPlanQuotaOverrideAction(_: RecordQuotaOverrideState, f: FormData): Promise<RecordQuotaOverrideState> { const id = String(f.get('organizationId') ?? ''); const hard = String(f.get('hardLimit') ?? '').trim(); return attempt<RecordQuotaOverrideState>(async () => { await requirePlatformCapability('platform.commercial'); const db = await getDb(); await recordPlanQuotaOverride(db, { organizationId: id, planId: String(f.get('planId') ?? ''), allowanceKey: String(f.get('allowanceKey') ?? ''), includedQuantity: Number(f.get('includedQuantity') ?? 0), hardLimit: hard ? Number(hard) : null, effectiveFrom: new Date(String(f.get('effectiveFrom') ?? '')).toISOString(), note: String(f.get('note') ?? '') }); }, { recorded: true }); }

/** Explicit operator bootstrap: membership + no current plan + no existing GOLD workspace. */
export async function initializeGoldWorkspaceAction(organizationId: string) {
  const db = await getDb();
  await bootstrapGoldInternalWorkspace(db, { organizationId });
  redirect(`/organizations/${organizationId}`);
}
