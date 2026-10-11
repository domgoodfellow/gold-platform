'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addAutomationAction,
  addAutomationCondition,
  addAutomationToolAction,
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
import { requireOrganization } from '@/lib/route/organization';

export type AutomationActionState = { error: string | null };

function rootPath(organizationId: string): string {
  return `/organizations/${organizationId}/automations`;
}

function rulePath(organizationId: string, ruleId: string): string {
  return `${rootPath(organizationId)}/${ruleId}`;
}

/**
 * Every write here follows the same shape: try the domain call, surface a `DomainError` as form
 * state, revalidate whichever pages this write could change. A rule-scoped write revalidates both
 * the root collection (its trigger/state/health cell) and the rule's own detail route; a
 * template-scoped write revalidates only the root, since Messages has no detail route of its own.
 */
async function run(paths: string[], write: () => Promise<unknown>): Promise<AutomationActionState> {
  try {
    await write();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  for (const path of paths) revalidatePath(path);
  for (const path of paths.filter((entry) => entry.endsWith('/automations'))) {
    revalidatePath(`${path}/rules`);
    revalidatePath(`${path}/messages`);
    revalidatePath(`${path}/activity`);
  }
  return { error: null };
}

export async function createRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  let ruleId: string;
  try {
    ruleId = await createAutomationRule(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      enabled: false,
      triggerKind: String(formData.get('triggerKind') ?? ''),
      triggerEventAction: String(formData.get('triggerEventAction') ?? ''),
      triggerMinutesBefore: Number(formData.get('triggerMinutesBefore') ?? Number.NaN),
      triggerMetric: String(formData.get('triggerMetric') ?? ''),
      triggerComparison: String(formData.get('triggerComparison') ?? ''),
      triggerThreshold: Number(formData.get('triggerThreshold') ?? Number.NaN),
      triggerUnit: String(formData.get('triggerUnit') ?? ''),
      triggerCounterStep: Number(formData.get('triggerCounterStep') ?? Number.NaN),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(rootPath(organizationId));
  // A rule is created with no conditions and no actions — the new detail route is where the
  // caller adds them, not back on the list requiring a second click to get there.
  redirect(rulePath(organizationId, ruleId));
}

export async function renameRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    updateAutomationRule(db, { id: ruleId, name: String(formData.get('name') ?? '') }),
  );
}

export async function setRuleEnabledAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    updateAutomationRule(db, { id: ruleId, enabled: String(formData.get('enabled') ?? '') === '1' }),
  );
}

export async function deleteRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  try {
    await deleteAutomationRule(db, { id: ruleId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(rootPath(organizationId));
  // The route this caller was on no longer resolves to anything — leaving them on it would be a
  // dead end, so this sends them back to the collection rather than returning success state.
  redirect(rootPath(organizationId));
}

export async function addConditionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    addAutomationCondition(db, {
      id: String(formData.get('conditionId') ?? '') || undefined,
      organizationId,
      ruleId,
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
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    removeAutomationCondition(db, { id: String(formData.get('conditionId') ?? '') }),
  );
}

export async function addActionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    addAutomationAction(db, {
      id: String(formData.get('actionId') ?? '') || undefined,
      organizationId,
      ruleId,
      kind: String(formData.get('kind') ?? ''),
      statusId: String(formData.get('statusId') ?? '') || null,
      templateId: String(formData.get('templateId') ?? '') || null,
      channel: String(formData.get('channel') ?? '') || null,
      shiftMinutes: Number(formData.get('shiftMinutes') ?? Number.NaN),
      typeId: String(formData.get('typeId') ?? '') || null,
    }),
  );
}

export async function addToolActionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');
  const [connectionId, capabilityKey] = String(formData.get('choice') ?? '').split('|');
  const answers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('arg_') && typeof value === 'string') answers[key.slice(4)] = value;
  }

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    addAutomationToolAction(db, {
      organizationId,
      ruleId,
      connectionId: connectionId ?? '',
      connectorName: String(formData.get('connectorName') ?? '').slice(0, 80),
      capabilityKey: capabilityKey ?? '',
      answers,
    }),
  );
}

export async function removeActionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const ruleId = String(formData.get('ruleId') ?? '');

  return run([rootPath(organizationId), rulePath(organizationId, ruleId)], () =>
    removeAutomationAction(db, { id: String(formData.get('actionId') ?? '') }),
  );
}

export async function createTemplateAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  return run([rootPath(organizationId)], () =>
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
  await requireOrganization(organizationId);

  return run([rootPath(organizationId)], () =>
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
  await requireOrganization(organizationId);

  return run([rootPath(organizationId)], () =>
    deleteMessageTemplate(db, { id: String(formData.get('templateId') ?? '') }),
  );
}
