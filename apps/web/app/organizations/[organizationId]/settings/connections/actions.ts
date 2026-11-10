'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { disconnectConnection } from '@/lib/domain/integrations/connections';
import { setAssistantAccess } from '@/lib/domain/integrations/assistant-grants';
import { checkConnection } from '@/lib/domain/integrations/oauth';
import { requireOrganization } from '@/lib/route/organization';
import { loadConfigurationContext } from '@/lib/route/workspace-configuration';
import { loadHeaderConnections } from '@/lib/application/shell/connection-menu';

export type ConnectState = { error: string | null };

/** Metadata only; every refresh proves membership, service access and current Connections eligibility. */
export async function headerConnectionsAction(organizationId: string, includeReadiness = true) {
  const { db, gate } = await loadConfigurationContext(organizationId);
  return loadHeaderConnections(db, { organizationId, gate, includeReadiness });
}

export type DisconnectState = { error: string | null };

export async function disconnectAction(
  _previous: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const connectionId = String(formData.get('connectionId') ?? '');

  try {
    await disconnectConnection(db, { organizationId, connectionId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/connections`);
  revalidatePath(`/organizations/${organizationId}/settings/connections/${connectionId}`);
  return { error: null };
}

export type CheckState = { error: string | null; checked: boolean };

/** Rotate the token if it is near expiry, and re-read who the account is and what it reaches. */
export async function checkConnectionAction(_previous: CheckState, formData: FormData): Promise<CheckState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const connectionId = String(formData.get('connectionId') ?? '');

  try {
    await checkConnection(db, { connectionId });
  } catch (error) {
    // The provider's own words are the message; the connection's own row now says needs attention too.
    revalidatePath(`/organizations/${organizationId}/settings/connections/${connectionId}`);
    if (error instanceof DomainError) return { error: error.message, checked: false };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/connections`);
  revalidatePath(`/organizations/${organizationId}/settings/connections/${connectionId}`);
  return { error: null, checked: true };
}

export type AccessState = { error: string | null };

/** Grant or withdraw the assistant's right to read one resource. A connection never implies it. */
export async function setAssistantAccessAction(_previous: AccessState, formData: FormData): Promise<AccessState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const connectionId = String(formData.get('connectionId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  const allowed = formData.get('allowed') === 'true';

  try {
    await setAssistantAccess(db, { organizationId, resourceId, allowed });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/connections/${connectionId}`);
  return { error: null };
}
