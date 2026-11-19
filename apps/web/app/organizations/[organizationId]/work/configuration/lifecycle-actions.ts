'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { deleteUnusedWorkType, retireWorkItemType } from '@/lib/domain/work-items/types';
import { DomainError } from '@/lib/domain/errors';

export async function workTypeLifecycleAction(_previous: { error: string | null }, form: FormData): Promise<{ error: string | null; success?: string }> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db } = await requireConfigurationTarget(organizationId, 'work-configuration');
  const typeId = String(form.get('typeId') ?? '');
  const operation = form.get('operation');
  try {
    const { data } = await db.from('work_item_types').select('id').eq('organization_id', organizationId).eq('id', typeId).maybeSingle();
    if (!data) return { error: 'Work type is unavailable.' };
    if (operation === 'delete') await deleteUnusedWorkType(db, typeId);
    else if (operation === 'archive' || operation === 'restore') await retireWorkItemType(db, typeId, operation === 'archive');
    else return { error: 'Choose a Work type action.' };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  if (operation === 'delete') redirect(`/organizations/${organizationId}/work/configuration`);
  return { error: null, success: operation === 'archive' ? 'Work type archived.' : 'Work type restored.' };
}
