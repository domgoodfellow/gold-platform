import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The steps a work item involves.
 *
 * A type may carry a **template** — see `TypeChecklistItem` below — and `create_work_item`
 * copies it onto the job at creation. The copy is the point: a job holds the steps it was
 * created with for the rest of its life, so editing a template never rewrites what somebody
 * already agreed to do or unticks what they already did (I8). There is still exactly one
 * table a screen reads a job's steps from.
 */
export type ChecklistItem = {
  id: string;
  label: string;
  position: number;
  /** When it was ticked, or null. Who ticked it is `doneBy`; a bare boolean would lose both. */
  doneAt: string | null;
  doneBy: string | null;
};

const LABEL_MAX = 200;

export async function listChecklistItems(
  db: Db,
  input: { organizationId: string; workItemId: string },
): Promise<ChecklistItem[]> {
  const { data, error } = await db
    .from('work_item_checklist_items')
    .select('id, label, position, done_at, done_by')
    .eq('organization_id', input.organizationId)
    .eq('work_item_id', input.workItemId)
    .order('position', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'checklists.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    position: row.position,
    doneAt: row.done_at,
    doneBy: row.done_by,
  }));
}

/**
 * Add a step.
 *
 * The organization is not an argument. `add_checklist_item` derives it from the work item
 * under the caller's own RLS, so it is not a fact this layer gets to assert.
 */
export async function addChecklistItem(
  db: Db,
  input: { workItemId: string; label: string; position?: number },
): Promise<string> {
  await requireActor(db);

  const label = input.label.trim();
  if (label.length === 0) {
    throw new DomainError('A step needs a label.', 'checklists.label_required');
  }
  if (label.length > LABEL_MAX) {
    throw new DomainError(
      `That label is longer than ${LABEL_MAX} characters.`,
      'checklists.label_too_long',
    );
  }

  const position = input.position ?? 0;
  if (!Number.isInteger(position) || position < 0) {
    throw new DomainError(
      'A position is a whole number, zero or more.',
      'checklists.position_invalid',
    );
  }

  const { data, error } = await db.rpc('add_checklist_item', {
    p_work_item_id: input.workItemId,
    p_label: label,
    p_position: position,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError('No such work item here.', 'checklists.work_item_not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot add steps here.', 'checklists.forbidden');
    }
    throw new DomainError(error.message, 'checklists.create_failed');
  }

  return data;
}

/**
 * Tick or untick a step.
 *
 * Who ticked it is not an argument either — the policy pins `done_by` to `auth.uid()`, so a
 * caller cannot record somebody else as having done the work (I11).
 */
export async function setChecklistItemDone(
  db: Db,
  input: { checklistItemId: string; done: boolean },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('set_checklist_item_done', {
    p_checklist_item_id: input.checklistItemId,
    p_done: input.done,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change that step.', 'checklists.forbidden');
    }
    throw new DomainError(error.message, 'checklists.update_failed');
  }
}


/**
 * A step every work item of one type starts with.
 *
 * This is configuration — `field.manage` — where the per-job rows are the job itself. The
 * relationship between the two is a copy at creation and nothing afterwards: no foreign key,
 * no join, no cascade. That is what makes editing a template safe.
 */
export type TypeChecklistItem = {
  id: string;
  label: string;
  position: number;
};

export async function listTypeChecklistItems(
  db: Db,
  input: { organizationId: string; typeId: string },
): Promise<TypeChecklistItem[]> {
  const { data, error } = await db
    .from('work_item_type_checklist_items')
    .select('id, label, position')
    .eq('organization_id', input.organizationId)
    .eq('type_id', input.typeId)
    .order('position', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'checklist_templates.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    position: row.position,
  }));
}

export async function addTypeChecklistItem(
  db: Db,
  input: { organizationId: string; typeId: string; label: string; position?: number },
): Promise<string> {
  await requireActor(db);

  const label = input.label.trim();
  if (label.length === 0) {
    throw new DomainError('A step needs a label.', 'checklist_templates.label_required');
  }
  if (label.length > LABEL_MAX) {
    throw new DomainError(
      `That label is longer than ${LABEL_MAX} characters.`,
      'checklist_templates.label_too_long',
    );
  }

  let position = input.position;
  if (position === undefined) {
    const existing = await listTypeChecklistItems(db, {
      organizationId: input.organizationId,
      typeId: input.typeId,
    });
    position = existing.reduce((highest, item) => Math.max(highest, item.position), -1) + 1;
  }

  const { data, error } = await db.rpc('add_type_checklist_item', {
    p_organization_id: input.organizationId,
    p_type_id: input.typeId,
    p_label: label,
    p_position: position,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError(
        'No such work item type here.',
        'checklist_templates.type_not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot configure steps here.',
        'checklist_templates.forbidden',
      );
    }
    throw new DomainError(error.message, 'checklist_templates.create_failed');
  }

  return data;
}

/**
 * Remove a step from a type's template.
 *
 * Work items already created keep their copies, which is not a caveat but the design: a job
 * that was created when the step existed genuinely did involve it.
 */
export async function removeTypeChecklistItem(
  db: Db,
  input: { id: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('remove_type_checklist_item', { p_id: input.id });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot configure steps here.',
        'checklist_templates.forbidden',
      );
    }
    throw new DomainError(error.message, 'checklist_templates.delete_failed');
  }
}
