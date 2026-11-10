import type { IntegrationConnection } from '@/lib/domain/integrations/connections';

export type HeaderConnectionAccount = {
  id: string;
  connectorKey: string;
  connectorName: string;
  logoUrl: string | null;
  accountLabel: string;
  status: IntegrationConnection['status'];
  /** Catalogue applicability, not a claim that the workspace has used this account. */
  workspaces: string[];
  manageHref: string;
  reconnectHref: string | null;
  reconnectsExternally: boolean;
};

export type HeaderConnections = {
  state: 'ready' | 'unavailable';
  accounts: HeaderConnectionAccount[];
  manageHref: string;
};

/** Workspace ordering changes presentation only; the accounts remain organization-owned. */
export function connectionAccountGroups(accounts: readonly HeaderConnectionAccount[], workspace?: string) {
  const order = (a: HeaderConnectionAccount, b: HeaderConnectionAccount) => a.connectorName.localeCompare(b.connectorName) || a.accountLabel.localeCompare(b.accountLabel) || a.id.localeCompare(b.id);
  return {
    relevant: workspace ? accounts.filter(account => account.workspaces.includes(workspace)).toSorted(order) : [],
    other: accounts.filter(account => !workspace || !account.workspaces.includes(workspace)).toSorted(order),
  };
}
