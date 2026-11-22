'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import { recordPlanMarginPolicy, recordPlanUtilizationAssumption, type PlanUtilizationAssumption } from '@/lib/domain/catalogue/plans';
import {
  saveDraftScenario,
  simulatePackageEconomics,
  type SimulationProfile,
  type SimulationSource,
} from '@/lib/domain/commercial/package-economics';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import type { AssumptionState, DraftScenarioState } from './action-states';

/**
 * Package economics in GildOps' Finance (ADR-057). Simulating reads costs (`cost.read`, the Economics
 * area); saving a scenario or an assumption records one (`cost.manage`). The database answers to the
 * same permissions in GildOps' operating organization; platform authority is not consulted.
 */

function packages(area: Awaited<ReturnType<typeof requireOperatingArea>>, manage: boolean) {
  if (!area.gate.featureAvailability.has('package_economics')) throw new DomainError('Package economics is not available for this business.', 'package_economics.unavailable');
  if (manage && !area.organization.capabilities.includes('cost.manage')) throw new DomainError('Your role cannot record economics assumptions.', 'package_economics.forbidden');
  return area;
}

export async function simulatePackageAction(input: {
  organizationId: string;
  sourceType: SimulationSource['type'];
  sourceId: string;
  profile: SimulationProfile;
  candidateAmountMinor?: number;
}) {
  try {
    const { db } = packages(await requireOperatingArea(input.organizationId, 'finance-economics'), false);
    return { data: await simulatePackageEconomics(db, { source: { type: input.sourceType, id: input.sourceId } as SimulationSource, profile: input.profile, candidateAmountMinor: input.candidateAmountMinor }), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Simulation failed.' };
  }
}

const optionalNumber = (value: FormDataEntryValue | null) => (value === null || String(value).trim() === '' ? undefined : Number(value));
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function saveDraftScenarioAction(_: DraftScenarioState, form: FormData): Promise<DraftScenarioState> {
  const organizationId = text(form, 'organizationId');
  try {
    const { db } = packages(await requireOperatingArea(organizationId, 'finance-economics'), true);
    const candidates = text(form, 'candidatePrices')
      .split(',')
      .map((value) => Math.round(Number(value.trim()) * 100))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (!candidates.length) throw new DomainError('Enter at least one candidate monthly price.', 'package_economics.candidates_required');
    const inputs = [...form.entries()].flatMap(([key, value]) => {
      if (!key.startsWith('usage:') || String(value).trim() === '') return [];
      const [, meterId] = key.split(':');
      return [{ allowanceKey: meterId, meterId, expectedQuantity: Number(value) }];
    });
    const directCostAmount = optionalNumber(form.get('directCostAmount'));
    const currency = text(form, 'currency') || 'CAD';
    await saveDraftScenario(db, {
      name: text(form, 'name'),
      notes: text(form, 'notes'),
      planId: text(form, 'planId'),
      currency,
      candidatePricesMinor: candidates,
      expectedSeats: optionalNumber(form.get('expectedSeats')),
      expectedResourceCount: optionalNumber(form.get('expectedResourceCount')),
      inputs,
      addonPlanIds: form.getAll('addonPlanId').map(String),
      directCosts: directCostAmount === undefined ? [] : [{
        label: text(form, 'directCostLabel') || 'Direct cost',
        amountMinor: Math.round(directCostAmount * 100),
        currency,
        note: 'Assumption',
      }],
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save the scenario.', saved: false };
  }
  revalidatePath(`/organizations/${organizationId}/finance/economics/packages`);
  return { error: null, saved: true };
}

const percentage = (form: FormData, key: string) => {
  const value = Number(text(form, key));
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new DomainError('Enter a percentage from 0 to 100.', 'package_economics.percentage_invalid');
  return value / 100;
};

/** The margins a plan is meant to keep in one currency: what it aims for, when to warn, and the floor. */
export async function recordMarginTargetsAction(_: AssumptionState, form: FormData): Promise<AssumptionState> {
  const organizationId = text(form, 'organizationId');
  try {
    const { db } = packages(await requireOperatingArea(organizationId, 'finance-economics'), true);
    await recordPlanMarginPolicy(db, {
      planId: text(form, 'planId'),
      currency: text(form, 'currency').toUpperCase(),
      targetMargin: percentage(form, 'targetMargin'),
      warningMargin: percentage(form, 'warningMargin'),
      hardFloorMargin: percentage(form, 'hardFloorMargin'),
      effectiveFrom: new Date().toISOString(),
      source: 'Finance',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/finance/economics/packages`);
  return { error: null, recorded: true };
}

const PROFILES: readonly PlanUtilizationAssumption['scenario'][] = ['low', 'expected', 'heavy', 'max_allowance'];

/** How much of one allowance a typical customer on the plan uses in one usage profile. */
export async function recordUsageAssumptionAction(_: AssumptionState, form: FormData): Promise<AssumptionState> {
  const organizationId = text(form, 'organizationId');
  try {
    const { db } = packages(await requireOperatingArea(organizationId, 'finance-economics'), true);
    const scenario = text(form, 'scenario') as PlanUtilizationAssumption['scenario'];
    if (!PROFILES.includes(scenario)) throw new DomainError('Choose a usage profile.', 'package_economics.scenario_invalid');
    await recordPlanUtilizationAssumption(db, {
      planId: text(form, 'planId'),
      scenario,
      allowanceKey: text(form, 'allowanceKey'),
      utilization: percentage(form, 'utilization'),
      effectiveFrom: new Date().toISOString(),
      source: 'Finance',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/finance/economics/packages`);
  return { error: null, recorded: true };
}
