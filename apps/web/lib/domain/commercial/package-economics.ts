import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { getPlanById, listPlanPrices, listPlanQuotas, type PlanQuota } from '@/lib/domain/catalogue/plans';
import {
  currentAddonAssignments,
  currentPlanAssignment,
  organizationEffectiveQuotas,
  organizationPlanPrice,
} from '@/lib/domain/catalogue/organization-plans';

export type SimulationProfile = 'low' | 'expected' | 'heavy' | 'max_allowance';
export type SimulationSource =
  | { type: 'plan_default'; id: string }
  | { type: 'draft_scenario'; id: string }
  | { type: 'organization_agreement'; id: string };

export type DraftScenarioSummary = {
  id: string;
  name: string;
  notes: string;
  revision: number;
  planId: string;
  currency: string;
  candidatePricesMinor: number[];
};

export type MeterEconomics = {
  allowanceKey: string;
  label: string;
  meterId: string | null;
  unit: string;
  allowance: number;
  expectedQuantity: number;
  knownCogsMinor: number;
  unknownComponents: string[];
  overageQuantity: number;
  overageRevenueMinor: number;
  overageRateMicros: number | null;
  overageRateSource: string | null;
  provenance: string;
};

export type PackageEconomicsResult = {
  sourceType: SimulationSource['type'];
  sourceId: string;
  sourceLabel: string;
  planId: string;
  planLabel: string;
  profile: SimulationProfile;
  currency: string;
  candidateAmountMinor: number;
  recurringRevenueMinor: number;
  usageRevenueMinor: number;
  totalRevenueMinor: number;
  knownProviderCogsMinor: number;
  manualDirectCogsMinor: number;
  totalKnownCogsMinor: number;
  grossContributionMinor: number | null;
  grossMargin: number | null;
  costCoverage: number;
  unknownCosts: string[];
  targetMargin: number | null;
  warningMargin: number | null;
  hardFloorMargin: number | null;
  status: 'healthy' | 'below_target' | 'below_floor' | 'incomplete_cost_data' | 'no_usage_assumptions';
  requiredRevenueForTargetMinor: number | null;
  meters: MeterEconomics[];
  selectedAddons: string[];
  priceSource: string;
};

type WorkingQuota = PlanQuota & { expectedQuantity?: number; utilization?: number; provenance: string };
type CostModel = {
  meter_id: string;
  component_key: string;
  provider_key: string;
  cost_meter_key: string;
  quantity_multiplier: number;
  region: string | null;
  direction: string | null;
  resource_type: string | null;
  required: boolean;
};
type ProviderRate = {
  provider_key: string;
  cost_meter_key: string;
  currency: string;
  unit_amount_micros: number;
  effective_from: string;
  effective_to: string | null;
  region: string | null;
  direction: string | null;
  resource_type: string | null;
  approval_state: string;
};
type FxRate = { base_currency: string; quote_currency: string; rate: number; effective_from: string; effective_to: string | null };
type RetailRate = {
  id: string;
  meter_id: string;
  currency: string;
  unit_amount_micros: number;
  plan_id: string | null;
  organization_id: string | null;
  billing_interval: string | null;
  effective_from: string;
  effective_to: string | null;
  approval_state: string;
  source: string;
};

type CalculationContext = {
  source: SimulationSource;
  sourceLabel: string;
  planId: string;
  planLabel: string;
  organizationId: string | null;
  currency: string;
  basePriceMinor: number;
  priceSource: string;
  candidatePricesMinor: number[];
  quotas: WorkingQuota[];
  selectedAddonLabels: string[];
  addonRevenueMinor: number;
  manualDirectCogsMinor: number;
  manualUnknownCosts: string[];
  assumptions: Map<string, number>;
  costModels: CostModel[];
  providerRates: ProviderRate[];
  fxRates: FxRate[];
  retailRates: RetailRate[];
  policy: { target: number; warning: number; floor: number } | null;
  at: string;
};

const PROFILE_DEFAULTS: Record<SimulationProfile, number> = {
  low: 0.25,
  expected: 0.5,
  heavy: 0.8,
  max_allowance: 1,
};

function asQuota(row: Awaited<ReturnType<typeof organizationEffectiveQuotas>>[number]): WorkingQuota {
  return {
    id: `${row.planKey}:${row.allowanceKey}`,
    planId: '',
    allowanceKey: row.allowanceKey,
    label: row.label,
    unit: row.unit,
    includedQuantity: row.includedQuantity,
    period: row.period as PlanQuota['period'],
    hardLimit: row.hardLimit,
    overagePolicy: row.overagePolicy as PlanQuota['overagePolicy'],
    serviceClass: row.serviceClass,
    meterId: row.meterId,
    displayOrder: 0,
    allowanceType: row.meterId ? 'usage' : 'capacity',
    resetSemantics: row.period === 'none' ? 'none' : 'billing_period',
    overageBehavior: row.overagePolicy === 'allowed' ? 'metered' : row.overagePolicy === 'blocked' ? 'hard_limit' : 'not_applicable',
    provenance: row.overridden ? `Contract override · Plan default` : `Inherited from ${row.planKey}`,
  };
}

function mergeQuotas(rows: WorkingQuota[]): WorkingQuota[] {
  const merged = new Map<string, WorkingQuota>();
  for (const row of rows) {
    const current = merged.get(row.allowanceKey);
    if (!current) merged.set(row.allowanceKey, { ...row });
    else {
      current.includedQuantity += row.includedQuantity;
      current.provenance = `${current.provenance} + ${row.provenance}`;
    }
  }
  return [...merged.values()];
}

function active(at: string, from: string, to: string | null): boolean {
  return from <= at && (!to || to > at);
}

function resolveProviderRate(context: CalculationContext, model: CostModel): { rate: number; currency: string } | null {
  const candidates = context.providerRates.filter((rate) =>
    rate.provider_key === model.provider_key && rate.cost_meter_key === model.cost_meter_key &&
    rate.approval_state === 'approved' && active(context.at, rate.effective_from, rate.effective_to) &&
    (!rate.region || rate.region === model.region) && (!rate.direction || rate.direction === model.direction) &&
    (!rate.resource_type || rate.resource_type === model.resource_type));
  candidates.sort((a, b) => {
    const specificity = (value: ProviderRate) => Number(Boolean(value.region)) + Number(Boolean(value.direction)) + Number(Boolean(value.resource_type));
    return specificity(b) - specificity(a) || b.effective_from.localeCompare(a.effective_from);
  });
  return candidates[0] ? { rate: Number(candidates[0].unit_amount_micros), currency: candidates[0].currency } : null;
}

function convertMicros(context: CalculationContext, micros: number, from: string): number | null {
  if (from === context.currency) return micros;
  const fx = context.fxRates
    .filter((rate) => rate.base_currency === from && rate.quote_currency === context.currency && active(context.at, rate.effective_from, rate.effective_to))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  return fx ? micros * Number(fx.rate) : null;
}

function resolveRetailRate(context: CalculationContext, meterId: string): RetailRate | null {
  const candidates = context.retailRates.filter((rate) =>
    rate.meter_id === meterId && rate.currency === context.currency && rate.approval_state === 'approved' &&
    active(context.at, rate.effective_from, rate.effective_to) &&
    (!rate.billing_interval || rate.billing_interval === 'month') &&
    (!rate.plan_id || rate.plan_id === context.planId) &&
    (!rate.organization_id || rate.organization_id === context.organizationId));
  candidates.sort((a, b) =>
    Number(Boolean(b.organization_id)) - Number(Boolean(a.organization_id)) ||
    Number(Boolean(b.plan_id)) - Number(Boolean(a.plan_id)) ||
    b.effective_from.localeCompare(a.effective_from));
  return candidates[0] ?? null;
}

export function calculatePackageEconomics(
  context: CalculationContext,
  profile: SimulationProfile,
  candidateAmountMinor = context.basePriceMinor,
): PackageEconomicsResult {
  let knownProviderCogsMinor = 0;
  let usageRevenueMinor = 0;
  let requiredComponents = 0;
  let knownComponents = 0;
  let hasUsageAssumptions = false;
  const unknown = new Set(context.manualUnknownCosts);
  const meters: MeterEconomics[] = [];

  for (const quota of context.quotas) {
    const utilization = quota.utilization ?? context.assumptions.get(`${profile}:${quota.allowanceKey}`) ?? PROFILE_DEFAULTS[profile];
    const quantity = quota.expectedQuantity ?? quota.includedQuantity * utilization;
    if (quota.meterId && quantity > 0) hasUsageAssumptions = true;
    let meterCostMicros = 0;
    const meterUnknown: string[] = [];
    const models = quota.meterId ? context.costModels.filter((model) => model.meter_id === quota.meterId) : [];
    for (const model of models) {
      if (model.required) requiredComponents += 1;
      const resolved = resolveProviderRate(context, model);
      if (!resolved) {
        if (model.required) meterUnknown.push(`${quota.label}: ${model.component_key} rate`);
        continue;
      }
      const converted = convertMicros(context, quantity * Number(model.quantity_multiplier) * resolved.rate, resolved.currency);
      if (converted === null) {
        if (model.required) meterUnknown.push(`${quota.label}: ${resolved.currency}/${context.currency} FX`);
        continue;
      }
      if (model.required) knownComponents += 1;
      meterCostMicros += converted;
    }
    if (quota.meterId && quantity > 0 && models.length === 0) meterUnknown.push(`${quota.label}: no cost model`);
    for (const item of meterUnknown) unknown.add(item);

    const overageQuantity = Math.max(0, quantity - quota.includedQuantity);
    const retailRate = quota.meterId && quota.overageBehavior === 'metered' ? resolveRetailRate(context, quota.meterId) : null;
    let overageRevenueMinor = 0;
    if (overageQuantity > 0 && quota.overageBehavior === 'metered') {
      if (retailRate) overageRevenueMinor = Math.round((overageQuantity * Number(retailRate.unit_amount_micros)) / 1_000_000);
      else unknown.add(`${quota.label}: overage rate`);
    }
    usageRevenueMinor += overageRevenueMinor;
    const knownCogsMinor = Math.round(meterCostMicros / 1_000_000);
    knownProviderCogsMinor += knownCogsMinor;
    meters.push({
      allowanceKey: quota.allowanceKey,
      label: quota.label,
      meterId: quota.meterId,
      unit: quota.unit,
      allowance: quota.includedQuantity,
      expectedQuantity: quantity,
      knownCogsMinor,
      unknownComponents: meterUnknown,
      overageQuantity,
      overageRevenueMinor,
      overageRateMicros: retailRate ? Number(retailRate.unit_amount_micros) : null,
      overageRateSource: retailRate ? (retailRate.organization_id ? 'Contract override' : retailRate.plan_id ? 'Plan override' : 'Platform default') : null,
      provenance: quota.provenance,
    });
  }

  const recurringRevenueMinor = candidateAmountMinor + context.addonRevenueMinor;
  const totalRevenueMinor = recurringRevenueMinor + usageRevenueMinor;
  const totalKnownCogsMinor = knownProviderCogsMinor + context.manualDirectCogsMinor;
  const unknownCosts = [...unknown];
  const complete = unknownCosts.length === 0;
  const contribution = complete ? totalRevenueMinor - totalKnownCogsMinor : null;
  const margin = complete && totalRevenueMinor > 0 ? contribution! / totalRevenueMinor : null;
  const policy = context.policy;
  const status = !hasUsageAssumptions
    ? 'no_usage_assumptions'
    : !complete
      ? 'incomplete_cost_data'
      : policy && margin! < policy.floor
        ? 'below_floor'
        : policy && margin! < policy.target
          ? 'below_target'
          : 'healthy';
  return {
    sourceType: context.source.type,
    sourceId: context.source.id,
    sourceLabel: context.sourceLabel,
    planId: context.planId,
    planLabel: context.planLabel,
    profile,
    currency: context.currency,
    candidateAmountMinor,
    recurringRevenueMinor,
    usageRevenueMinor,
    totalRevenueMinor,
    knownProviderCogsMinor,
    manualDirectCogsMinor: context.manualDirectCogsMinor,
    totalKnownCogsMinor,
    grossContributionMinor: contribution,
    grossMargin: margin,
    costCoverage: requiredComponents ? knownComponents / requiredComponents : hasUsageAssumptions ? 0 : 1,
    unknownCosts,
    targetMargin: policy?.target ?? null,
    warningMargin: policy?.warning ?? null,
    hardFloorMargin: policy?.floor ?? null,
    status,
    requiredRevenueForTargetMinor: complete && policy ? Math.ceil(totalKnownCogsMinor / (1 - policy.target)) : null,
    meters,
    selectedAddons: context.selectedAddonLabels,
    priceSource: context.priceSource,
  };
}

async function latestDraft(db: Db, scenarioId: string) {
  const { data: scenario, error: scenarioError } = await db.from('commercial_draft_scenarios').select('id,name,notes').eq('id', scenarioId).is('archived_at', null).single();
  if (scenarioError) throw new DomainError(scenarioError.message, 'package_economics.draft_failed');
  const { data: version, error: versionError } = await db.from('commercial_draft_scenario_versions').select('id,revision,plan_id,currency,candidate_prices_minor,expected_seats,expected_resource_count').eq('scenario_id', scenarioId).order('revision', { ascending: false }).limit(1).single();
  if (versionError) throw new DomainError(versionError.message, 'package_economics.draft_failed');
  const [inputs, addons, costs] = await Promise.all([
    db.from('commercial_draft_scenario_inputs').select('allowance_key,meter_id,expected_quantity,utilization').eq('version_id', version.id),
    db.from('commercial_draft_scenario_addons').select('addon_plan_id').eq('version_id', version.id),
    db.from('commercial_draft_scenario_direct_costs').select('label,amount_minor,currency,note').eq('version_id', version.id),
  ]);
  for (const result of [inputs, addons, costs]) if (result.error) throw new DomainError(result.error.message, 'package_economics.draft_failed');
  return { scenario, version, inputs: inputs.data ?? [], addons: addons.data ?? [], costs: costs.data ?? [] };
}

export async function listDraftScenarios(db: Db): Promise<DraftScenarioSummary[]> {
  const { data, error } = await db.from('commercial_draft_scenarios').select('id,name,notes').is('archived_at', null).order('name');
  if (error) throw new DomainError(error.message, 'package_economics.drafts_failed');
  return Promise.all((data ?? []).map(async (scenario) => {
    const { data: version, error: versionError } = await db.from('commercial_draft_scenario_versions').select('revision,plan_id,currency,candidate_prices_minor').eq('scenario_id', scenario.id).order('revision', { ascending: false }).limit(1).single();
    if (versionError) throw new DomainError(versionError.message, 'package_economics.drafts_failed');
    return { id: scenario.id, name: scenario.name, notes: scenario.notes, revision: version.revision, planId: version.plan_id, currency: version.currency, candidatePricesMinor: version.candidate_prices_minor.map(Number) };
  }));
}

export async function saveDraftScenario(db: Db, input: {
  scenarioId?: string; name: string; notes?: string; planId: string; currency: string;
  candidatePricesMinor: number[]; expectedSeats?: number; expectedResourceCount?: number;
  inputs: Array<{ allowanceKey: string; meterId?: string; expectedQuantity?: number; utilization?: number }>;
  addonPlanIds?: string[]; directCosts?: Array<{ label: string; amountMinor: number; currency: string; note?: string }>;
}): Promise<string> {
  const { data, error } = await db.rpc('save_commercial_draft_scenario', ({
    p_scenario_id: input.scenarioId ?? null,
    p_name: input.name,
    p_notes: input.notes ?? '',
    p_plan_id: input.planId,
    p_currency: input.currency,
    p_candidate_prices_minor: input.candidatePricesMinor,
    p_expected_seats: input.expectedSeats ?? null,
    p_expected_resource_count: input.expectedResourceCount ?? null,
    p_inputs: input.inputs,
    p_addon_plan_ids: input.addonPlanIds ?? [],
    p_direct_costs: input.directCosts ?? [],
  }) as never);
  if (error) throw new DomainError(error.code === '42501' ? 'Only platform staff may save reference scenarios.' : error.message, 'package_economics.save_draft_failed');
  return data as string;
}

async function loadContext(db: Db, source: SimulationSource): Promise<CalculationContext> {
  const at = new Date().toISOString();
  let planId: string;
  let organizationId: string | null = null;
  let sourceLabel: string;
  let currency = 'CAD';
  let basePriceMinor = 0;
  let priceSource = 'Plan default';
  let candidatePricesMinor: number[] = [];
  let quotas: WorkingQuota[] = [];
  let addonIds: string[] = [];
  let manualDirectCogsMinor = 0;
  const manualUnknownCosts: string[] = [];

  if (source.type === 'draft_scenario') {
    const draft = await latestDraft(db, source.id);
    planId = draft.version.plan_id;
    sourceLabel = draft.scenario.name;
    currency = draft.version.currency;
    candidatePricesMinor = draft.version.candidate_prices_minor.map(Number);
    basePriceMinor = candidatePricesMinor[0] ?? 0;
    priceSource = `Draft scenario · revision ${draft.version.revision}`;
    addonIds = draft.addons.map((row) => row.addon_plan_id);
    quotas = (await listPlanQuotas(db, planId)).map((quota) => ({ ...quota, provenance: 'Plan default' }));
    const byKey = new Map(draft.inputs.map((row) => [row.allowance_key, row]));
    const byMeter = new Map(draft.inputs.filter((row) => row.meter_id).map((row) => [row.meter_id!, row]));
    quotas = quotas.map((quota) => {
      const value = byKey.get(quota.allowanceKey) ?? (quota.meterId ? byMeter.get(quota.meterId) : undefined);
      const expectedQuantity = value?.expected_quantity !== null && value?.expected_quantity !== undefined
        ? Number(value.expected_quantity)
        : quota.unit === 'user' && draft.version.expected_seats !== null
          ? Number(draft.version.expected_seats)
          : quota.allowanceType === 'recurring_resource' && draft.version.expected_resource_count !== null
            ? Number(draft.version.expected_resource_count)
            : undefined;
      return { ...quota, expectedQuantity, utilization: value?.utilization === null || value?.utilization === undefined ? undefined : Number(value.utilization), provenance: value || expectedQuantity !== undefined ? 'Draft scenario assumption' : quota.provenance };
    });
    for (const cost of draft.costs) {
      if (cost.currency === currency) manualDirectCogsMinor += Number(cost.amount_minor);
      else manualUnknownCosts.push(`${cost.label}: ${cost.currency}/${currency} FX`);
    }
  } else if (source.type === 'organization_agreement') {
    organizationId = source.id;
    const assignment = await currentPlanAssignment(db, { organizationId });
    if (!assignment) throw new DomainError('This organization has no current base Plan.', 'package_economics.no_plan');
    planId = assignment.planId;
    sourceLabel = 'Organization agreement';
    const price = await organizationPlanPrice(db, { organizationId, planId, at });
    if (price) { currency = price.currency; basePriceMinor = price.amountMinor; priceSource = price.source === 'agreement' ? 'Contract override' : 'Plan default'; }
    quotas = (await organizationEffectiveQuotas(db, { organizationId, at })).map(asQuota);
    addonIds = (await currentAddonAssignments(db, { organizationId })).map((row) => row.planId);
    candidatePricesMinor = [basePriceMinor];
  } else {
    planId = source.id;
    sourceLabel = 'Plan default';
    const prices = await listPlanPrices(db, planId);
    const current = prices.find((price) => price.approvalState === 'approved' && price.billingInterval === 'month' && price.effectiveFrom <= at && (!price.effectiveTo || price.effectiveTo > at));
    if (current) { currency = current.currency; basePriceMinor = current.amountMinor; }
    candidatePricesMinor = [basePriceMinor];
    quotas = (await listPlanQuotas(db, planId)).map((quota) => ({ ...quota, provenance: 'Plan default' }));
    const { data, error } = await db.from('platform_plan_addons').select('addon_plan_id').eq('plan_id', planId).eq('included_by_default', true);
    if (error) throw new DomainError(error.message, 'package_economics.addons_failed');
    addonIds = (data ?? []).map((row) => row.addon_plan_id);
  }

  const plan = await getPlanById(db, planId);
  if (!plan) throw new DomainError('The selected Plan no longer exists.', 'package_economics.no_plan');
  const addonPlans = (await Promise.all(addonIds.map((id) => getPlanById(db, id)))).filter((item) => item !== null);
  let addonRevenueMinor = 0;
  for (const addon of addonPlans) {
    const addonQuotas = await listPlanQuotas(db, addon.id);
    quotas.push(...addonQuotas.map((quota) => ({ ...quota, provenance: `Add-on · ${addon.label}` })));
    if (source.type === 'organization_agreement' && organizationId) {
      const price = await organizationPlanPrice(db, { organizationId, planId: addon.id, at });
      if (price && price.currency === currency) addonRevenueMinor += price.amountMinor;
      else if (price) manualUnknownCosts.push(`${addon.label}: ${price.currency}/${currency} revenue`);
    } else {
      const prices = await listPlanPrices(db, addon.id);
      const price = prices.find((item) => item.approvalState === 'approved' && item.billingInterval === 'month' && item.currency === currency && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
      if (price) addonRevenueMinor += price.amountMinor;
      else manualUnknownCosts.push(`${addon.label}: recurring price`);
    }
  }
  quotas = mergeQuotas(quotas);

  const meterIds = [...new Set(quotas.map((quota) => quota.meterId).filter((value): value is string => Boolean(value)))];
  const [assumptionsResult, modelsResult, providerRatesResult, fxResult, retailResult, policyResult] = await Promise.all([
    db.from('platform_plan_utilization_assumptions').select('scenario,allowance_key,utilization,effective_from').eq('plan_id', planId).lte('effective_from', at).order('effective_from', { ascending: false }),
    meterIds.length ? db.from('platform_meter_cost_model_components').select('meter_id,component_key,provider_key,cost_meter_key,quantity_multiplier,region,direction,resource_type,required').in('meter_id', meterIds) : Promise.resolve({ data: [], error: null }),
    db.from('platform_provider_rates').select('provider_key,cost_meter_key,currency,unit_amount_micros,effective_from,effective_to,region,direction,resource_type,approval_state').lte('effective_from', at),
    db.from('platform_fx_rates').select('base_currency,quote_currency,rate,effective_from,effective_to').lte('effective_from', at),
    meterIds.length ? db.from('platform_retail_rates').select('id,meter_id,currency,unit_amount_micros,plan_id,organization_id,billing_interval,effective_from,effective_to,approval_state,source').in('meter_id', meterIds).eq('currency', currency).lte('effective_from', at) : Promise.resolve({ data: [], error: null }),
    db.from('platform_plan_margin_policies').select('target_margin,warning_margin,hard_floor_margin,effective_from').eq('plan_id', planId).eq('currency', currency).lte('effective_from', at).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const result of [assumptionsResult, modelsResult, providerRatesResult, fxResult, retailResult, policyResult]) {
    if (result.error) throw new DomainError(result.error.message, 'package_economics.context_failed');
  }
  const assumptions = new Map<string, number>();
  for (const row of assumptionsResult.data ?? []) {
    const key = `${row.scenario}:${row.allowance_key}`;
    if (!assumptions.has(key)) assumptions.set(key, Number(row.utilization));
  }
  const policy = policyResult.data ? { target: Number(policyResult.data.target_margin), warning: Number(policyResult.data.warning_margin), floor: Number(policyResult.data.hard_floor_margin) } : null;
  return {
    source, sourceLabel, planId, planLabel: plan.label, organizationId, currency, basePriceMinor,
    priceSource, candidatePricesMinor, quotas, selectedAddonLabels: addonPlans.map((item) => item.label),
    addonRevenueMinor, manualDirectCogsMinor, manualUnknownCosts, assumptions,
    costModels: (modelsResult.data ?? []).map((row) => ({ ...row, quantity_multiplier: Number(row.quantity_multiplier) })),
    providerRates: (providerRatesResult.data ?? []).map((row) => ({ ...row, unit_amount_micros: Number(row.unit_amount_micros) })),
    fxRates: (fxResult.data ?? []).map((row) => ({ ...row, rate: Number(row.rate) })),
    retailRates: (retailResult.data ?? []).map((row) => ({ ...row, unit_amount_micros: Number(row.unit_amount_micros) })),
    policy, at,
  };
}

export async function simulatePackageEconomics(db: Db, input: { source: SimulationSource; profile: SimulationProfile; candidateAmountMinor?: number }): Promise<{ result: PackageEconomicsResult; comparisons: PackageEconomicsResult[]; maxAllowance: PackageEconomicsResult }> {
  const context = await loadContext(db, input.source);
  const result = calculatePackageEconomics(context, input.profile, input.candidateAmountMinor ?? context.basePriceMinor);
  const candidates = context.candidatePricesMinor.length ? context.candidatePricesMinor : [context.basePriceMinor];
  return {
    result,
    comparisons: candidates.map((amount) => calculatePackageEconomics(context, input.profile, amount)),
    maxAllowance: calculatePackageEconomics(context, 'max_allowance', input.candidateAmountMinor ?? context.basePriceMinor),
  };
}
