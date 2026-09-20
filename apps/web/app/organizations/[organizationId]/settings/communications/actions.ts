'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordOrganizationEmailDomain } from '@/lib/domain/providers/bindings';

export type RecordDomainState = { error: string | null; recorded: boolean };

export const RECORD_DOMAIN_INITIAL: RecordDomainState = { error: null, recorded: false };

export async function recordEmailDomainAction(
  _previous: RecordDomainState,
  formData: FormData,
): Promise<RecordDomainState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

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
