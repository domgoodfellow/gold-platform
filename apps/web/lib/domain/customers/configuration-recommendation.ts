import type { Db } from '@/lib/db/types';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts, type CatalogProductKey } from '@/lib/domain/catalogue/catalogue';
import type { DiscoverySnapshotAnswers } from '@/lib/domain/customers/discovery-snapshots';
import type { DiscoveryRequirementKey } from '@/lib/domain/customers/discovery-requirements';
import { WORKSPACES, type WorkspaceKey } from '@/lib/navigation';

/**
 * What a discovery answer suggests, in the canonical catalogue's own words — never a provider or
 * an implementation detail (Twilio, a webhook, a Supabase row), only the outcome a Feature is the
 * customer-facing surface of (the capability-catalogue seam, ADR-005; the brief this follows: "recommend outcomes/capabilities,
 * not internal provider infrastructure").
 *
 * Deliberately not persisted (the one-calculation rule's reasoning extended: a recommendation computed fresh from the
 * catalogue and the snapshot is one answer; a stored copy is a second one that can disagree with
 * either the moment a requirement is re-answered or a Feature's `implementationState` changes).
 * A commercial proposal that needs to freeze one in time snapshots it onto its own row when that
 * slice arrives — this function is not that row.
 */
const REQUIREMENT_FEATURE_MAP: Record<DiscoveryRequirementKey, readonly string[]> = {
  contactChannels: ['inbound_calling', 'inbound_sms', 'outbound_sms'],
  bookingIntake: ['booking', 'booking_intake'],
  phoneHandling: ['inbound_calling', 'call_controls', 'voicemail', 'business_hours_routing'],
  teamAccess: ['ownership_assignment'],
  websiteSurfaces: ['pages_sections', 'draft_review_publish'],
  customerSelfService: ['portal_auth', 'portal_history'],
  workersResources: ['resource_records', 'assignment'],
  locationConstraints: ['locations', 'weather_aware_dispatch'],
  quoteInvoiceModel: ['quote_creation', 'invoices'],
  postContactWorkflow: ['rule_authoring', 'domain_event_trigger'],
  automationGoals: ['rule_authoring', 'email_action'],
  existingSoftware: ['app_connections', 'data_mapping'],
};

export type ConfigurationRecommendationEntry = {
  featureKey: string;
  label: string;
  productKey: CatalogProductKey;
  productLabel: string;
  moduleLabel: string;
};

export type ConfigurationRecommendation = {
  /** A Feature at least one answered requirement points to. */
  recommended: ConfigurationRecommendationEntry[];
  /** A Feature in the same Module as something recommended, offered without a direct signal for it. */
  optional: ConfigurationRecommendationEntry[];
  /** A Feature only a requirement marked "not applicable" points to. */
  notNeeded: ConfigurationRecommendationEntry[];
};

/**
 * Recommend catalogue Features from a customer's discovery snapshot.
 *
 * Signal is deliberately coarse — *a requirement was answered* recommends its mapped Features,
 * regardless of what the freeform answer says. Reading the words themselves to tell "prefers
 * text" from "prefers a phone call" apart is a different, later capability (an LLM reading a
 * discovery answer) that this function does not have and must not pretend to.
 *
 * Never recommends a Feature whose `implementationState` is `planned` — offering something that
 * does not work yet is exactly the false claim the no-dead-end rule refuses, catalogue outcome or not.
 */
export async function recommendConfiguration(
  db: Db,
  input: { answers: DiscoverySnapshotAnswers },
): Promise<ConfigurationRecommendation> {
  const [products, modules, features] = await Promise.all([
    listCatalogProducts(db),
    listCatalogModules(db),
    listCatalogFeatures(db),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const moduleById = new Map(modules.map((catalogModule) => [catalogModule.id, catalogModule]));
  const featureByKey = new Map(features.map((feature) => [feature.key, feature]));

  function toEntry(featureKey: string): ConfigurationRecommendationEntry | null {
    const feature = featureByKey.get(featureKey);
    if (!feature || feature.implementationState === 'planned') return null;
    const catalogModule = moduleById.get(feature.moduleId);
    const product = catalogModule ? productById.get(catalogModule.productId) : undefined;
    return {
      featureKey: feature.key,
      label: feature.label,
      productKey: product?.key ?? 'workspace',
      productLabel: product?.label ?? '',
      moduleLabel: catalogModule?.label ?? '',
    };
  }

  const recommendedKeys = new Set<string>();
  const notNeededKeys = new Set<string>();

  const answers = input.answers;
  for (const [key, mappedFeatureKeys] of Object.entries(REQUIREMENT_FEATURE_MAP) as [
    DiscoveryRequirementKey,
    readonly string[],
  ][]) {
    const answer = answers[key];
    if (!answer) continue;
    if (answer.status === 'not_applicable') {
      for (const featureKey of mappedFeatureKeys) notNeededKeys.add(featureKey);
    } else if (answer.value.trim().length > 0) {
      for (const featureKey of mappedFeatureKeys) recommendedKeys.add(featureKey);
    }
  }
  // A requirement that was actually answered outranks one marked not applicable pointing at the
  // same Feature — a real signal beats an absence of one.
  for (const featureKey of recommendedKeys) notNeededKeys.delete(featureKey);

  const recommendedModuleIds = new Set(
    [...recommendedKeys].map((key) => featureByKey.get(key)?.moduleId).filter((id): id is string => Boolean(id)),
  );
  const optionalKeys = features
    .filter(
      (feature) =>
        recommendedModuleIds.has(feature.moduleId) &&
        !recommendedKeys.has(feature.key) &&
        !notNeededKeys.has(feature.key),
    )
    .map((feature) => feature.key);

  const recommended = [...recommendedKeys].map(toEntry).filter((entry): entry is ConfigurationRecommendationEntry => entry !== null);
  const optional = optionalKeys.map(toEntry).filter((entry): entry is ConfigurationRecommendationEntry => entry !== null);
  const notNeeded = [...notNeededKeys].map(toEntry).filter((entry): entry is ConfigurationRecommendationEntry => entry !== null);

  return { recommended, optional, notNeeded };
}

export type WorkspacePreview = {
  workspace: WorkspaceKey;
  label: string;
  entries: ConfigurationRecommendationEntry[];
};

/**
 * The recommended set, grouped by the canonical operator workspaces whose capability maps name
 * each Feature. This is Feature-to-workspace rather than Product-to-workspace: one Product may
 * contribute to several workspaces and one workspace may compose several Products. Workspaces
 * with no matching recommendation draw no empty preview row.
 */
export function previewByWorkspace(recommended: readonly ConfigurationRecommendationEntry[]): WorkspacePreview[] {
  return WORKSPACES.map((workspace) => ({
    workspace: workspace.key,
    label: workspace.label,
    entries: recommended.filter((entry) => (workspace.featureKeys as readonly string[]).includes(entry.featureKey)),
  })).filter((preview) => preview.entries.length > 0);
}
