'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { requirePlatformArea } from '@/lib/route/platform';
import {
  saveDraftScenario,
  simulatePackageEconomics,
  type SimulationProfile,
  type SimulationSource,
} from '@/lib/domain/commercial/package-economics';

export async function simulatePackageAction(input: {
  platformOrganizationId: string;
  sourceType: SimulationSource['type'];
  sourceId: string;
  profile: SimulationProfile;
  candidateAmountMinor?: number;
}) {
  try {
    await requirePlatformArea(input.platformOrganizationId, 'platform.commercial');
    const db = await getDb();
    return { data: await simulatePackageEconomics(db, { source: { type: input.sourceType, id: input.sourceId } as SimulationSource, profile: input.profile, candidateAmountMinor: input.candidateAmountMinor }), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Simulation failed.' };
  }
}

export type DraftScenarioState = { error: string | null; saved: boolean };

const optionalNumber = (value: FormDataEntryValue | null) => value === null || String(value).trim() === '' ? undefined : Number(value);

export async function saveDraftScenarioAction(_: DraftScenarioState, formData: FormData): Promise<DraftScenarioState> {
  try {
    const platformOrganizationId = String(formData.get('platformOrganizationId') ?? '');
    await requirePlatformArea(platformOrganizationId, 'platform.commercial');
    const candidates = String(formData.get('candidatePrices') ?? '')
      .split(',')
      .map((value) => Math.round(Number(value.trim()) * 100))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (!candidates.length) throw new Error('Enter at least one candidate monthly price.');
    const inputs = [...formData.entries()].flatMap(([key, value]) => {
      if (!key.startsWith('usage:') || String(value).trim() === '') return [];
      const [, meterId] = key.split(':');
      return [{ allowanceKey: meterId, meterId, expectedQuantity: Number(value) }];
    });
    const addonPlanIds = formData.getAll('addonPlanId').map(String);
    const directCostAmount = optionalNumber(formData.get('directCostAmount'));
    const directCosts = directCostAmount === undefined ? [] : [{
      label: String(formData.get('directCostLabel') ?? 'Manual direct cost'),
      amountMinor: Math.round(directCostAmount * 100),
      currency: String(formData.get('currency') ?? 'CAD'),
      note: 'Manual assumption',
    }];
    const db = await getDb();
    await saveDraftScenario(db, {
      name: String(formData.get('name') ?? ''),
      notes: String(formData.get('notes') ?? ''),
      planId: String(formData.get('planId') ?? ''),
      currency: String(formData.get('currency') ?? 'CAD'),
      candidatePricesMinor: candidates,
      expectedSeats: optionalNumber(formData.get('expectedSeats')),
      expectedResourceCount: optionalNumber(formData.get('expectedResourceCount')),
      inputs,
      addonPlanIds,
      directCosts,
    });
    revalidatePath(`/organizations/${platformOrganizationId}/platform/package-economics`);
    return { error: null, saved: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save the scenario.', saved: false };
  }
}
