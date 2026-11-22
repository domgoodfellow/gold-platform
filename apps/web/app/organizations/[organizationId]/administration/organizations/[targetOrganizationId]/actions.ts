'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { requirePlatformCapability, revalidatePlatform } from '@/lib/route/platform';
import { recordProviderResource, setProviderResourceStatus } from '@/lib/domain/providers/bindings';
import { provisionTelephonySubaccount } from '@/lib/domain/providers/twilio-provisioning';
import { endSupportSession, startSupportSession } from '@/lib/domain/platform/support';
import { saveBusinessAsTemplate } from '@/lib/domain/configuration/proposals';
import { TELEPHONY_RESOURCE_TYPES, telephonyProviderKey } from '@/lib/adapters/telephony';
import type { ProvisionTwilioState, RegisterResourceState, SetResourceStatusState, SupportSessionState, SaveTemplateState } from './action-states';


/**
 * Administration's writes onto one business: provider resources, support sessions, designating
 * GildOps' own organization and saving a setup as a template. Its subscription, prices and terms
 * are GildOps' Finance (`finance/subscriptions/actions.ts`), never written from here. Each write
 * is checked by the database function behind it; template saving also proves `platform.catalogue`
 * here, from the caller's own operating-organization membership rather than a form field.
 */
async function attempt<T extends { error: string | null }>(operation: () => Promise<void>, success: Omit<T, 'error'>): Promise<T> { try { await operation(); revalidatePlatform(); return { ...success, error: null } as T; } catch (error) { return { ...success, error: error instanceof Error ? error.message : 'Unable to record change.' } as T; } }
export async function provisionTwilioAction(_: ProvisionTwilioState, f: FormData): Promise<ProvisionTwilioState> { const id = String(f.get('organizationId') ?? ''); const result = await attempt<ProvisionTwilioState>(async () => { const db = await getDb(); await provisionTelephonySubaccount(db, { organizationId: id }); }, { provisioned: true }); return result; }
export async function registerPhoneNumberAction(_: RegisterResourceState, f: FormData): Promise<RegisterResourceState> { const id = String(f.get('organizationId') ?? ''); return attempt<RegisterResourceState>(async () => { const db = await getDb(); await recordProviderResource(db, { organizationId: id, providerKey: telephonyProviderKey(), resourceType: TELEPHONY_RESOURCE_TYPES.phoneNumber, externalId: String(f.get('number') ?? '').trim() }); }, { recorded: true }); }
export async function setResourceStatusAction(_: SetResourceStatusState, f: FormData): Promise<SetResourceStatusState> { const id = String(f.get('organizationId') ?? ''); return attempt<SetResourceStatusState>(async () => { const db = await getDb(); await setProviderResourceStatus(db, { organizationId: id, resourceId: String(f.get('resourceId') ?? ''), status: String(f.get('status') ?? '') as 'pending', error: String(f.get('errorDetail') ?? '') || null }); }, { recorded: true }); }
export async function startSupportSessionAction(_: SupportSessionState, f: FormData) { const id = String(f.get('organizationId') ?? ''); return attempt(async () => { const db = await getDb(); await startSupportSession(db, { organizationId: id, reason: String(f.get('reason') ?? '') || undefined }); }, {}); }
export async function endSupportSessionAction(_: SupportSessionState, f: FormData) { return attempt(async () => { const db = await getDb(); await endSupportSession(db, { id: String(f.get('sessionId') ?? '') }); }, {}); }

/** Explicit operator bootstrap: membership + no current plan + no designated operating organization. */
export async function initializeGoldWorkspaceAction(organizationId: string) {
  const db = await getDb();
  await bootstrapOperatingOrganization(db, { organizationId });
  redirect(`/organizations/${organizationId}`);
}

/** Save this business's setup as an unpublished starting template. `platform.catalogue` on the server, and again in the table's own policy. */
export async function saveAsTemplateAction(_: SaveTemplateState, f: FormData): Promise<SaveTemplateState> {
  const name = String(f.get('name') ?? '').trim();
  return attempt<SaveTemplateState>(async () => {
    await requirePlatformCapability('platform.catalogue');
    const db = await getDb();
    await saveBusinessAsTemplate(db, {
      organizationId: String(f.get('organizationId') ?? ''), name,
      description: String(f.get('description') ?? ''), category: String(f.get('category') ?? ''),
    });
  }, { saved: name });
}
