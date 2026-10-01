import type { Db } from '@/lib/db/types';
import { getPlanById, listPlanPrices, type PlanPrice } from '@/lib/domain/catalogue/plans';
import { currentPlanAssignment, organizationEffectiveQuotas, type EffectiveQuota } from '@/lib/domain/catalogue/organization-plans';
import { listUsageEvents, type UsageEvent } from '@/lib/domain/commercial/usage';
import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import { getOrganizationSubscription, type OrganizationSubscription } from '@/lib/domain/platform-billing/subscriptions';
import { listConnections } from '@/lib/domain/integrations/connections';
import { isConnectable, listConnectors, type Connector } from '@/lib/domain/integrations/connectors';

/**
 * What this business's Finance Home summarizes — a projection over reads that already exist
 * elsewhere (I4/I5's reasoning, extended to a summary screen, the way `studioOverview` already
 * does it for Studio). Nothing here totals, prices or reconciles anything a second time; every
 * figure is the same one Settings → Plan & usage already shows, never GOLD's own cost or a
 * margin (D43) — this file reads only the tenant-safe functions those pages already call.
 */

/** A financial system, as far as the connector catalogue's open `category` vocabulary can say so today. No schema addition: a label an admin already edits (`connectors.ts`). */
const FINANCIAL_CONNECTOR_CATEGORIES = new Set(['accounting', 'banking', 'payments', 'payroll', 'commerce']);

function isFinancialCategory(category: string): boolean {
  return FINANCIAL_CONNECTOR_CATEGORIES.has(category.trim().toLowerCase());
}

export type FinanceSubscription = {
  planLabel: string;
  price: { amountMinor: number; currency: string; billingInterval: PlanPrice['billingInterval'] } | null;
  subscription: OrganizationSubscription | null;
};

export type FinanceConnection = {
  connectorKey: string;
  connectorName: string;
  status: 'connecting' | 'active' | 'needs_attention' | 'disconnected';
};

export type FinanceOverview = {
  /** Null when this organization has no Plan assigned yet — a fact Finance Home says plainly rather than guessing at a price. */
  subscription: FinanceSubscription | null;
  billingProviderConfigured: boolean;
  quotas: EffectiveQuota[];
  recentUsage: UsageEvent[];
  /** This business's own connections that are to a financial system, active or not. */
  financialConnections: FinanceConnection[];
  /** Whether any financial-category connector is actually connectable today, for the contextual prompt when the list above is empty. */
  hasConnectableFinancialConnector: boolean;
};

async function resolveSubscription(
  db: Db,
  input: { organizationId: string; currency: string | null; billingProviderConfigured: boolean },
): Promise<FinanceSubscription | null> {
  const assignment = await currentPlanAssignment(db, { organizationId: input.organizationId });
  if (!assignment) return null;

  const plan = await getPlanById(db, assignment.planId);
  if (!plan) return null;

  const [prices, subscription] = await Promise.all([
    listPlanPrices(db, plan.id),
    input.billingProviderConfigured
      ? getOrganizationSubscription(db, { organizationId: input.organizationId })
      : Promise.resolve(null),
  ]);

  const approvedPrice = input.currency
    ? prices.find((price) => price.approvalState === 'approved' && price.currency === input.currency)
    : undefined;

  return {
    planLabel: plan.label,
    price: approvedPrice
      ? { amountMinor: approvedPrice.amountMinor, currency: approvedPrice.currency, billingInterval: approvedPrice.billingInterval }
      : null,
    subscription,
  };
}

function resolveFinancialConnections(
  connections: Awaited<ReturnType<typeof listConnections>>,
  connectors: Connector[],
): FinanceConnection[] {
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  return connections
    .filter((connection) => {
      const connector = connectorByKey.get(connection.connectorKey);
      return connector ? isFinancialCategory(connector.category) : false;
    })
    .map((connection) => ({
      connectorKey: connection.connectorKey,
      connectorName: connectorByKey.get(connection.connectorKey)?.name ?? connection.connectorKey,
      status: connection.status,
    }));
}

export async function financeOverview(
  db: Db,
  input: { organizationId: string; currency: string | null },
): Promise<FinanceOverview> {
  const billingProviderConfigured = Boolean(await platformBillingProvider());

  const [subscription, quotas, recentUsage, connections, connectors] = await Promise.all([
    resolveSubscription(db, { ...input, billingProviderConfigured }),
    organizationEffectiveQuotas(db, { organizationId: input.organizationId }),
    listUsageEvents(db, { organizationId: input.organizationId, limit: 10 }),
    listConnections(db, { organizationId: input.organizationId }),
    listConnectors(db),
  ]);

  return {
    subscription,
    billingProviderConfigured,
    quotas,
    recentUsage,
    financialConnections: resolveFinancialConnections(connections, connectors),
    hasConnectableFinancialConnector: connectors.some(
      (connector) => isFinancialCategory(connector.category) && isConnectable(connector),
    ),
  };
}
