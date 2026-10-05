import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * Which Provider Service, Provider Account and model answers one AI capability.
 *
 * **GOLD-owned and platform-wide, like a Provider Account itself.** A tenant bringing its own
 * model key is a different feature with a different record (D33) — nothing here carries an
 * `organizationId`. Three capabilities exist today because three callers actually resolve one:
 * `operator_assistant` (`apps/api/api/ai_ask.py`), `public_assistant`
 * (`apps/api/api/public_chat.py`) and `configuration_drafting`
 * (`apps/api/api/ai_draft_configuration.py`). `app.ai_capabilities()` in Postgres is the list
 * these must equal; `ai-runtime-assignments.test.ts` holds the two together.
 *
 * **The row itself is unreadable directly** (`platform_ai_runtime_assignments` carries no select
 * grant to any role) — `platform_ai_runtime_assignment_overview` is the one door a screen reads
 * through, and `record_ai_runtime_assignment` is the one door that writes.
 */

export const AI_CAPABILITIES = ['operator_assistant', 'public_assistant', 'configuration_drafting'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_CAPABILITY_LABEL: Record<AiCapability, string> = {
  operator_assistant: 'Operator assistant',
  public_assistant: 'Public assistant',
  configuration_drafting: 'Configuration drafting',
};

export type AiRuntimeAssignment = {
  capability: AiCapability;
  providerServiceId: string;
  providerKey: string;
  providerServiceKey: string;
  providerServiceLabel: string;
  providerAccountId: string;
  providerAccountLabel: string;
  model: string;
  updatedAt: string;
};

type Row = {
  capability: string;
  provider_service_id: string;
  provider_key: string;
  provider_service_key: string;
  provider_service_label: string;
  provider_account_id: string;
  provider_account_label: string;
  model: string;
  updated_at: string;
};

function fromRow(row: Row): AiRuntimeAssignment {
  return {
    capability: row.capability as AiCapability,
    providerServiceId: row.provider_service_id,
    providerKey: row.provider_key,
    providerServiceKey: row.provider_service_key,
    providerServiceLabel: row.provider_service_label,
    providerAccountId: row.provider_account_id,
    providerAccountLabel: row.provider_account_label,
    model: row.model,
    updatedAt: row.updated_at,
  };
}

/** Staff only: the underlying table has no select grant, so anyone else reads an empty list. */
export async function listAiRuntimeAssignments(db: Db): Promise<AiRuntimeAssignment[]> {
  const { data, error } = await db.rpc('platform_ai_runtime_assignment_overview');
  if (error) throw new DomainError(error.message, 'ai_runtime.list_failed');
  return ((data ?? []) as Row[]).map(fromRow);
}

function writeError(error: { code?: string; message: string }): DomainError {
  if (error.code === '42501') return new DomainError('Only platform staff may assign AI runtime.', 'ai_runtime.forbidden');
  return new DomainError(error.message, 'ai_runtime.write_failed');
}

/**
 * Assigns, or reassigns, which Provider Service, Provider Account and model answers one
 * capability. Refuses (at the database, not merely in this form) a service with no runtime
 * implementation, a provider/account mismatch, or an inactive or uncredentialed account.
 */
export async function recordAiRuntimeAssignment(
  db: Db,
  input: {
    capability: AiCapability;
    providerServiceId: string;
    providerAccountId: string;
    model: string;
  },
): Promise<void> {
  const model = input.model.trim();
  if (!model) throw new DomainError('A model is required.', 'ai_runtime.invalid');

  const { error } = await db.rpc('record_ai_runtime_assignment', {
    p_capability: input.capability,
    p_provider_service_id: input.providerServiceId,
    p_provider_account_id: input.providerAccountId,
    p_model: model,
  });
  if (error) throw writeError(error);
}
