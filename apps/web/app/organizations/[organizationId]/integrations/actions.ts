'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { disconnectConnection, recordConnection } from '@/lib/domain/integrations/connections';
import { checkConnection } from '@/lib/domain/integrations/oauth';

export type ConnectState = { error: string | null };

/**
 * CSV needs no vendor handshake — there is no account to authorize, so this writes the
 * connection directly rather than opening an OAuth flow. A future connector with a real vendor
 * (Google, HubSpot) replaces this call site's body with a redirect into that vendor's own
 * consent screen; the connection it eventually records is the same table, the same shape.
 */
export async function connectCsvAction(
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await recordConnection(db, {
      organizationId,
      connectorKey: 'csv',
      accountLabel: 'Uploaded files',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/integrations`);
  return { error: null };
}

export type DisconnectState = { error: string | null };

export async function disconnectAction(
  _previous: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const connectionId = String(formData.get('connectionId') ?? '');

  try {
    await disconnectConnection(db, { organizationId, connectionId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/integrations`);
  revalidatePath(`/organizations/${organizationId}/integrations/${connectionId}`);
  return { error: null };
}

export type CheckState = { error: string | null; checked: boolean };

/** Rotate the token if it is near expiry, and re-read who the account is and what it reaches. */
export async function checkConnectionAction(_previous: CheckState, formData: FormData): Promise<CheckState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const connectionId = String(formData.get('connectionId') ?? '');

  try {
    await checkConnection(db, { connectionId });
  } catch (error) {
    // The provider's own words are the message; the connection's own row now says needs attention too.
    revalidatePath(`/organizations/${organizationId}/integrations/${connectionId}`);
    if (error instanceof DomainError) return { error: error.message, checked: false };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/integrations`);
  revalidatePath(`/organizations/${organizationId}/integrations/${connectionId}`);
  return { error: null, checked: true };
}
