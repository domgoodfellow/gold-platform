'use server';

import { revalidatePath } from 'next/cache';
import {
  addAutomationAction,
  addAutomationCondition,
  createAutomationRule,
  deleteAutomationRule,
  removeAutomationAction,
  removeAutomationCondition,
  updateAutomationRule,
} from '@/lib/domain/automation/rules';
import {
  createMessageTemplate,
  deleteMessageTemplate,
  updateMessageTemplate,
} from '@/lib/domain/automation/templates';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';

export type AutomationActionState = { error: string | null };

/**
 * Eleven writes and one shape, because each is a separate decision with its own failure.
 *
 * The alternative was one action taking an intent, which is what the locations screen does for
 * two operations that share a form. These do not share a form: a rule's name, its conditions and
 * its actions are three lists on one card, and folding them together would mean inventing an
 * order and a partial-success message.
 */
async function run(
  organizationId: string,
  write: () => Promise<unknown>,
): Promise<AutomationActionState> {
  try {
    await write();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/automations`);
  return { error: null };
}

export async function createRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    createAutomationRule(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      triggerKind: String(formData.get('triggerKind') ?? ''),
      triggerEventAction: String(formData.get('triggerEventAction') ?? ''),
      triggerMinutesBefore: Number(formData.get('triggerMinutesBefore') ?? Number.NaN),
      triggerMetric: String(formData.get('triggerMetric') ?? ''),
      triggerComparison: String(formData.get('triggerComparison') ?? ''),
      triggerThreshold: Number(formData.get('triggerThreshold') ?? Number.NaN),
      triggerUnit: String(formData.get('triggerUnit') ?? ''),
      triggerCounterStep: Number(formData.get('triggerCounterStep') ?? Number.NaN),
    }),
  );
}

export async function renameRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    updateAutomationRule(db, {
      id: String(formData.get('ruleId') ?? ''),
      name: String(formData.get('name') ?? ''),
    }),
  );
}

export async function setRuleEnabledAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    updateAutomationRule(db, {
      id: String(formData.get('ruleId') ?? ''),
      enabled: String(formData.get('enabled') ?? '') === '1',
    }),
  );
}

export async function deleteRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    deleteAutomationRule(db, { id: String(formData.get('ruleId') ?? '') }),
  );
}

export async function addConditionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    addAutomationCondition(db, {
      organizationId,
      ruleId: String(formData.get('ruleId') ?? ''),
      subjectField: String(formData.get('subjectField') ?? ''),
      operator: String(formData.get('operator') ?? ''),
      value: String(formData.get('value') ?? ''),
    }),
  );
}

export async function removeConditionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    removeAutomationCondition(db, { id: String(formData.get('conditionId') ?? '') }),
  );
}

export async function addActionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    addAutomationAction(db, {
      organizationId,
      ruleId: String(formData.get('ruleId') ?? ''),
      kind: String(formData.get('kind') ?? ''),
      statusId: String(formData.get('statusId') ?? '') || null,
      templateId: String(formData.get('templateId') ?? '') || null,
      channel: String(formData.get('channel') ?? '') || null,
      shiftMinutes: Number(formData.get('shiftMinutes') ?? Number.NaN),
      typeId: String(formData.get('typeId') ?? '') || null,
    }),
  );
}

export async function removeActionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    removeAutomationAction(db, { id: String(formData.get('actionId') ?? '') }),
  );
}

export async function createTemplateAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    createMessageTemplate(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      subject: String(formData.get('subject') ?? ''),
      body: String(formData.get('body') ?? ''),
    }),
  );
}

export async function updateTemplateAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    updateMessageTemplate(db, {
      id: String(formData.get('templateId') ?? ''),
      name: String(formData.get('name') ?? ''),
      subject: String(formData.get('subject') ?? ''),
      body: String(formData.get('body') ?? ''),
    }),
  );
}

export async function deleteTemplateAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return run(organizationId, () =>
    deleteMessageTemplate(db, { id: String(formData.get('templateId') ?? '') }),
  );
}
