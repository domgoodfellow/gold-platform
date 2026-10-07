'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { requireAccessToken } from '@/lib/api/client';
import { changeCustomerStage } from '@/lib/api/crm';
import { createCustomerStage, updateCustomerStage } from '@/lib/domain/customers/stages';
import { DomainError } from '@/lib/domain/errors';
import { requireOrganization } from '@/lib/route/organization';

/**
 * CRM/Sales's own writes: naming the pipeline's stages, and moving a customer along it.
 *
 * **Stage definitions stay TypeScript-authoritative** (`createCustomerStage`,
 * `updateCustomerStage` in `lib/domain/customers/stages.ts`, unchanged) — naming a stage is
 * configuration, no different from naming a custom field, and nothing about this extraction
 * changes that. **Moving a customer is the one write here that reaches
 * `apps/api/app/domains/crm/stages.py`** — see `changeCustomerStageAction` below and that
 * module's own comment for why it is the FastAPI-authoritative act while `updateCustomer`
 * (the customer detail page's bundled edit) remains a second, unrelated act touching the same
 * column.
 */

export type FormState = { error: string | null };
export type ChangeStageState = { error: string | null };

async function attempt(organizationId: string, run: () => Promise<unknown>): Promise<FormState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/customers/pipeline`);
  revalidatePath(`/organizations/${organizationId}/customers`);
  revalidatePath(`/organizations/${organizationId}/sales`);
  revalidatePath(`/organizations/${organizationId}/settings/sales-stages`);
  return { error: null };
}

export async function createStageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, () =>
    createCustomerStage(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      position: Number(formData.get('position') ?? 0),
    }),
  );
}

export async function updateStageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, () =>
    updateCustomerStage(db, {
      id: String(formData.get('id') ?? ''),
      name: String(formData.get('name') ?? ''),
      position: Number(formData.get('position') ?? 0),
    }),
  );
}

/**
 * Move a customer to a different stage, from the board.
 *
 * Reaches `apps/api/app/domains/crm/stages.py::change_customer_stage` under the operator's own
 * forwarded access token (D17, D34) — the FastAPI-authoritative write for this act.
 */
export async function changeCustomerStageAction(
  _previous: ChangeStageState,
  formData: FormData,
): Promise<ChangeStageState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const customerId = String(formData.get('customerId') ?? '');
  const stageId = String(formData.get('stageId') ?? '');

  return attempt(organizationId, async () => {
    const token = await requireAccessToken(db);
    await changeCustomerStage({
      token,
      organizationId,
      customerId,
      // An empty select is "no stage", which is a real answer.
      stageId: stageId === '' ? null : stageId,
    });
  });
}
