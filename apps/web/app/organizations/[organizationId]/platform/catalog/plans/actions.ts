'use server';

import { redirect } from 'next/navigation';
import { callerPlatformHref, revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { createPlan, type PlanKind } from '@/lib/domain/catalogue/plans';
import { DomainError } from '@/lib/domain/errors';

export type CreatePlanState = { error: string | null };

export async function createPlanAction(_: CreatePlanState, formData: FormData): Promise<CreatePlanState> {
  const key = String(formData.get('key') ?? '').trim();
  try {
    await createPlan(await getDb(), {
      key,
      kind: String(formData.get('kind') ?? 'plan') as PlanKind,
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      billable: formData.get('billable') !== 'off',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePlatform();
  redirect((await callerPlatformHref(`catalog/plans/${key}`)) ?? '/organizations');
}
