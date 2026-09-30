'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordOrganizationEmailDomain } from '@/lib/domain/providers/bindings';
import { requireOrganization } from '@/lib/route/organization';

export type RecordDomainState = { error: string | null; recorded: boolean };

export const RECORD_DOMAIN_INITIAL: RecordDomainState = { error: null, recorded: false };

export type CommunicationProfileState = { error: string | null; success?: string };

/**
 * The website's public assistant — greeting, instructions, handoff — is behaviour Communications
 * already owns (D25: a switch leads to its inputs, once). It moved here from the Website workbench
 * so drafting/publishing copy and configuring what a visitor's message does stay two different
 * questions; the site it applies to is still named by `siteId`, read from the public-site domain.
 */
export async function saveCommunicationProfileAction(_state: CommunicationProfileState, formData: FormData): Promise<CommunicationProfileState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const siteId = String(formData.get('siteId') ?? '');
  await requireOrganization(organizationId);
  try {
    const db = await getDb();
    const rpc = db.rpc.bind(db) as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    const result = await rpc('update_public_communication_profile', {
      p_organization_id: organizationId,
      p_site_id: siteId,
      p_enabled: formData.get('enabled') === 'on',
      p_display_name: String(formData.get('displayName') ?? ''),
      p_greeting: String(formData.get('greeting') ?? ''),
      p_instructions: String(formData.get('instructions') ?? ''),
      p_handoff_message: String(formData.get('handoffMessage') ?? ''),
      p_handoff_destination: String(formData.get('handoffDestination') ?? ''),
    });
    if (result.error) throw new DomainError(result.error.message, 'communications.profile_save_failed');
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Website messaging could not be saved.' };
  }
  revalidatePath(`/organizations/${organizationId}/settings/communications`);
  return { error: null, success: 'Website messaging saved.' };
}

export async function recordEmailDomainAction(
  _previous: RecordDomainState,
  formData: FormData,
): Promise<RecordDomainState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await recordOrganizationEmailDomain(db, {
      organizationId,
      domain: String(formData.get('domain') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/communications`);
  return { error: null, recorded: true };
}
