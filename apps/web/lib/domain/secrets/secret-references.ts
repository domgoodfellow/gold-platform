import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * A Secret Reference: a private value a business gave GildOps to use for one stated purpose. Not a
 * platform provider account (GildOps' own credential), not an integration connection (a delegated
 * sign-in to somebody else's account), and not a provisioned resource's generated secret.
 *
 * **This module cannot read a value and never will.** It writes through four doors that return no
 * value, and lists names and states. The only reader is a machine role in `apps/api`
 * whose door this runtime does not name, call or import.
 */

export type SecretReference = {
  id: string;
  key: string;
  label: string;
  purpose: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  lastResolvedAt: string | null;
};

export const SECRET_VALUE_MAX = 8192;

/** The name a consumer asks for, written as the environment variable it becomes. */
const KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Each already means something to a runtime that may one day receive the value; `NEXT_PUBLIC_` ends up in a browser bundle. */
const RESERVED = /^(NEXT_PUBLIC_|GOLD_|GILDOPS_|SUPABASE_|VERCEL_)/;

/** Validate here so a person gets a sentence; the table's CHECKs remain the guarantee. */
export function validateSecretKey(key: string): string {
  if (!KEY.test(key)) {
    throw new DomainError(
      'A name is capital letters, digits and underscores, starting with a letter — for example PARTNER_API_KEY.',
      'secrets.key_invalid',
    );
  }
  if (RESERVED.test(key)) {
    throw new DomainError(
      'That name starts with a prefix that means something to the platform or a browser. Choose another.',
      'secrets.key_reserved',
    );
  }
  return key;
}

function validateValue(value: string): string {
  if (value.trim() === '') throw new DomainError('Enter the value to store.', 'secrets.value_empty');
  if (value.length > SECRET_VALUE_MAX) {
    throw new DomainError(`A value is at most ${SECRET_VALUE_MAX} characters.`, 'secrets.value_too_long');
  }
  return value;
}

/**
 * What a person is told about one reference. Derived from facts that happened — a consumer asked
 * for it or none did — never from a health check nobody ran, so there is no *healthy* here.
 */
export type SecretUse = 'disabled' | 'not_used_yet' | 'used';

export function secretUse(reference: Pick<SecretReference, 'status' | 'lastResolvedAt'>): SecretUse {
  if (reference.status === 'disabled') return 'disabled';
  return reference.lastResolvedAt === null ? 'not_used_yet' : 'used';
}

function refused(error: { code?: string; message: string }, fallback: string): DomainError {
  if (error.code === '42501') return new DomainError('Your role cannot manage this business’s private credentials.', 'secrets.forbidden');
  if (error.code === '23505') return new DomainError('A secret with that name already exists. Replace it instead.', 'secrets.duplicate');
  if (error.code === '22023') return new DomainError('That secret no longer exists.', 'secrets.not_found');
  // The database's own message may quote an argument; nothing derived from one may reach a person.
  return new DomainError('That could not be saved.', fallback);
}

const COLUMNS = 'id, key, label, purpose, status, created_at, updated_at, rotated_at, last_resolved_at';

export async function listSecretReferences(db: Db, input: { organizationId: string }): Promise<SecretReference[]> {
  const { data, error } = await db
    .from('secret_references')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('key');
  if (error) throw new DomainError('The stored credentials could not be read.', 'secrets.list_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    purpose: row.purpose,
    status: row.status as SecretReference['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rotatedAt: row.rotated_at,
    lastResolvedAt: row.last_resolved_at,
  }));
}

export async function createSecretReference(
  db: Db,
  input: { organizationId: string; key: string; label: string; purpose: string; value: string },
): Promise<string> {
  const key = validateSecretKey(input.key.trim());
  if (input.label.trim() === '') throw new DomainError('Give the credential a label.', 'secrets.label_empty');
  const value = validateValue(input.value);
  const { data, error } = await db.rpc('create_secret_reference', {
    p_organization_id: input.organizationId,
    p_key: key,
    p_label: input.label,
    p_purpose: input.purpose,
    p_value: value,
  });
  if (error) throw refused(error, 'secrets.create_failed');
  return data;
}

export async function rotateSecretReference(
  db: Db,
  input: { organizationId: string; secretId: string; value: string; label?: string; purpose?: string },
): Promise<void> {
  const value = validateValue(input.value);
  const { error } = await db.rpc('rotate_secret_reference', {
    p_organization_id: input.organizationId,
    p_secret_id: input.secretId,
    p_value: value,
    p_label: input.label,
    p_purpose: input.purpose,
  });
  if (error) throw refused(error, 'secrets.rotate_failed');
}

export async function setSecretReferenceStatus(
  db: Db,
  input: { organizationId: string; secretId: string; status: SecretReference['status'] },
): Promise<void> {
  const { error } = await db.rpc('set_secret_reference_status', {
    p_organization_id: input.organizationId,
    p_secret_id: input.secretId,
    p_status: input.status,
  });
  if (error) throw refused(error, 'secrets.status_failed');
}

export async function deleteSecretReference(db: Db, input: { organizationId: string; secretId: string }): Promise<void> {
  const { error } = await db.rpc('delete_secret_reference', {
    p_organization_id: input.organizationId,
    p_secret_id: input.secretId,
  });
  if (error) throw refused(error, 'secrets.delete_failed');
}
