'use server';

import { revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { recordAiRuntimeAssignment, type AiCapability } from '@/lib/domain/ai/runtime';
import type { RuntimeAssignmentFormState } from './action-states';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'That could not be completed.';
}

/**
 * Assigns which Provider Service, Provider Account and model answers one AI capability. Every
 * refusal that matters — an unimplemented service, a provider/account mismatch, an inactive or
 * uncredentialed account — is the database's own (`record_ai_runtime_assignment`); this action
 * only relays it.
 */
export async function saveRuntimeAssignmentAction(
  _: RuntimeAssignmentFormState,
  form: FormData,
): Promise<RuntimeAssignmentFormState> {
  try {
    await recordAiRuntimeAssignment(await getDb(), {
      capability: String(form.get('capability') ?? '') as AiCapability,
      providerServiceId: String(form.get('providerServiceId') ?? ''),
      providerAccountId: String(form.get('providerAccountId') ?? ''),
      model: String(form.get('model') ?? ''),
    });
    revalidatePlatform();
    return { error: null, saved: true };
  } catch (error) {
    return { error: message(error), saved: false };
  }
}
