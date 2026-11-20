'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { addItemExpectedCost, removeItemExpectedCost, setStageExpectedCost } from '@/lib/domain/pricing/expected-costs';
import { requireOrganization } from '@/lib/route/organization';

/**
 * Expected costs of what a business sells: lines on a priced item, and time and cost per hour on
 * the stages of the Work type that delivers it. Finance owns them; Work type settings edits the
 * stage figures through the same actions. Each checks `cost.manage` here and again in the database.
 */

export type ExpectedCostState = { error: string | null; success?: string };

async function context(form: FormData) {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('cost.manage')) throw new DomainError('Your role cannot change expected costs.', 'expected_costs.forbidden');
  return { db, organization, organizationId };
}

function refresh(organizationId: string) {
  revalidatePath(`/organizations/${organizationId}/finance/catalog`, 'layout');
  revalidatePath(`/organizations/${organizationId}/finance/reports`);
  revalidatePath(`/organizations/${organizationId}/work/configuration`);
  revalidatePath(`/organizations/${organizationId}/work`);
}

function failed(error: unknown): ExpectedCostState {
  if (error instanceof DomainError) return { error: error.message };
  throw error;
}

export async function addItemExpectedCostAction(_: ExpectedCostState, form: FormData): Promise<ExpectedCostState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = String(form.get('itemId') ?? '');
    const item = (await listPriceBookItems(db, { organizationId })).find((candidate) => candidate.id === itemId);
    if (!item) return { error: 'This item is no longer in the price book.' };
    await addItemExpectedCost(db, {
      organizationId,
      itemId,
      description: String(form.get('description') ?? ''),
      amountMinor: parseMoneyInput(String(form.get('amount') ?? ''), item.currency),
      currency: item.currency,
    });
    refresh(organizationId);
    return { error: null, success: 'Expected cost added.' };
  } catch (error) {
    return failed(error);
  }
}

export async function removeItemExpectedCostAction(_: ExpectedCostState, form: FormData): Promise<ExpectedCostState> {
  try {
    const { db, organizationId } = await context(form);
    await removeItemExpectedCost(db, { organizationId, id: String(form.get('id') ?? '') });
    refresh(organizationId);
    return { error: null, success: 'Expected cost removed.' };
  } catch (error) {
    return failed(error);
  }
}

/** Saves a stage's expected time and cost per hour; both left empty clears them. */
export async function setStageExpectedCostAction(_: ExpectedCostState, form: FormData): Promise<ExpectedCostState> {
  try {
    const { db, organization, organizationId } = await context(form);
    const statusId = String(form.get('statusId') ?? '');
    const minutes = String(form.get('minutes') ?? '').trim();
    const rate = String(form.get('hourlyCost') ?? '').trim();
    if (minutes === '' && rate === '') {
      await setStageExpectedCost(db, { organizationId, statusId, value: null });
    } else {
      if (!organization.currency) return { error: 'Choose a trading currency in Settings → General first.' };
      if (minutes === '' || !/^\d+$/.test(minutes)) return { error: 'Enter the expected time in whole minutes.' };
      await setStageExpectedCost(db, {
        organizationId,
        statusId,
        value: { expectedMinutes: Number(minutes), hourlyCostMinor: rate === '' ? 0 : parseMoneyInput(rate, organization.currency), currency: organization.currency },
      });
    }
    refresh(organizationId);
    return { error: null, success: 'Stage cost saved.' };
  } catch (error) {
    return failed(error);
  }
}
