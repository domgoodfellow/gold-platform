'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import {
  createSecretReference,
  deleteSecretReference,
  rotateSecretReference,
  setSecretReferenceStatus,
} from '@/lib/domain/secrets/secret-references';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The Secrets & credentials writes. **Every result is `{ error }` and nothing else** — a value
 * enters through the form and never leaves through a result, a redirect, a URL or a log: the
 * refusal below is a sentence the domain wrote, never an echo of what was submitted.
 */

/**
 * `draft` hands back what a person typed that is not secret, so a refusal does not cost them the
 * name, label and purpose they wrote. **It never carries the value**: that field is always empty
 * again after an attempt, which is also what a person would want of a secret that did not save.
 */
const text = (formData: FormData, name: string) => String(formData.get(name) ?? '');

export type SecretFormState = {
  error: string | null;
  saved?: boolean;
  draft?: { key: string; label: string; purpose: string };
};

async function attempt(
  organizationId: string,
  formData: FormData,
  run: () => Promise<unknown>,
): Promise<SecretFormState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, draft: { key: text(formData, 'key'), label: text(formData, 'label'), purpose: text(formData, 'purpose') } };
    }
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/settings/secrets`);
  return { error: null, saved: true };
}

export async function createSecretAction(_previous: SecretFormState, formData: FormData): Promise<SecretFormState> {
  const organizationId = text(formData, 'organizationId');
  const { db } = await requireOrganization(organizationId);
  return attempt(organizationId, formData, () =>
    createSecretReference(db, {
      organizationId,
      key: text(formData, 'key'),
      label: text(formData, 'label'),
      purpose: text(formData, 'purpose'),
      value: text(formData, 'value'),
    }),
  );
}

export async function replaceSecretAction(_previous: SecretFormState, formData: FormData): Promise<SecretFormState> {
  const organizationId = text(formData, 'organizationId');
  const { db } = await requireOrganization(organizationId);
  return attempt(organizationId, formData, () =>
    rotateSecretReference(db, {
      organizationId,
      secretId: text(formData, 'secretId'),
      value: text(formData, 'value'),
      label: text(formData, 'label'),
      purpose: text(formData, 'purpose'),
    }),
  );
}

export async function setSecretStatusAction(_previous: SecretFormState, formData: FormData): Promise<SecretFormState> {
  const organizationId = text(formData, 'organizationId');
  const { db } = await requireOrganization(organizationId);
  const status = text(formData, 'status') === 'disabled' ? 'disabled' : 'active';
  return attempt(organizationId, formData, () =>
    setSecretReferenceStatus(db, { organizationId, secretId: text(formData, 'secretId'), status }),
  );
}

export async function deleteSecretAction(_previous: SecretFormState, formData: FormData): Promise<SecretFormState> {
  const organizationId = text(formData, 'organizationId');
  const { db } = await requireOrganization(organizationId);
  return attempt(organizationId, formData, () => deleteSecretReference(db, { organizationId, secretId: text(formData, 'secretId') }));
}
