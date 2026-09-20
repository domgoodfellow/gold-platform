'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  removeConnectorApp,
  setConnectorApp,
  upsertConnector,
  uploadConnectorLogo,
  type ConnectorInput,
} from '@/lib/domain/integrations/connectors';
import { CONNECTOR_CATALOGUE_CACHE_TAG } from '@/lib/domain/integrations/published-cache';

// Initial states live in the client components that call `useActionState` — a `'use server'`
// file may export only async functions.
export type ConnectorState = { error: string | null; saved: boolean };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function toInput(formData: FormData, existing: { iconRef: string | null } | null): ConnectorInput {
  return {
    key: text(formData, 'key'),
    name: text(formData, 'name'),
    description: text(formData, 'description'),
    category: text(formData, 'category'),
    suite: text(formData, 'suite') || null,
    status: text(formData, 'status') as ConnectorInput['status'],
    authMethod: text(formData, 'authMethod') as ConnectorInput['authMethod'],
    connectionMethod: text(formData, 'connectionMethod') as ConnectorInput['connectionMethod'],
    isPublic: formData.get('isPublic') === 'on',
    displayOrder: Number(text(formData, 'displayOrder') || 0),
    iconRef: existing?.iconRef ?? null,
    marketingSlug: text(formData, 'marketingSlug') || null,
    marketingSummary: text(formData, 'marketingSummary'),
    marketingDescription: text(formData, 'marketingDescription'),
    capabilities: formData.getAll('capabilities').map(String) as ConnectorInput['capabilities'],
  };
}

function refresh(key: string) {
  // The public catalogue is cached; an edit here is what expires it, so no deployment is needed.
  updateTag(CONNECTOR_CATALOGUE_CACHE_TAG);
  revalidatePath('/platform/integrations');
  revalidatePath(`/platform/integrations/${key}`);
}

/** Create: sends the person to the new connector's own page. Edit: saves in place. */
export async function saveConnectorAction(_: ConnectorState, formData: FormData): Promise<ConnectorState> {
  const creating = formData.get('mode') === 'create';
  const db = await getDb();
  let key: string;
  try {
    // An edit never re-derives the logo from the form; only the logo action changes it.
    const iconRef = creating ? null : String(formData.get('iconRef') ?? '') || null;
    const input = toInput(formData, { iconRef });
    key = input.key;
    await upsertConnector(db, input);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    throw error;
  }
  refresh(key);
  if (creating) redirect(`/platform/integrations/${key}`);
  return { error: null, saved: true };
}

export async function uploadLogoAction(_: ConnectorState, formData: FormData): Promise<ConnectorState> {
  const file = formData.get('logo');
  const key = text(formData, 'key');
  try {
    if (!(file instanceof File) || file.size === 0) throw new DomainError('Choose an image to upload.', 'integrations.logo_invalid');
    await uploadConnectorLogo(await getDb(), { key, file });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    throw error;
  }
  refresh(key);
  return { error: null, saved: true };
}

export async function saveConnectorAppAction(_: ConnectorState, formData: FormData): Promise<ConnectorState> {
  const connectorKey = text(formData, 'connectorKey');
  try {
    await setConnectorApp(await getDb(), {
      connectorKey,
      key: text(formData, 'key'),
      name: text(formData, 'name'),
      description: text(formData, 'description'),
      displayOrder: Number(text(formData, 'displayOrder') || 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    throw error;
  }
  refresh(connectorKey);
  return { error: null, saved: true };
}

export async function removeConnectorAppAction(formData: FormData): Promise<void> {
  const connectorKey = text(formData, 'connectorKey');
  await removeConnectorApp(await getDb(), { connectorKey, key: text(formData, 'key') });
  refresh(connectorKey);
}
