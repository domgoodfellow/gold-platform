export type AccountFormState = { error: string | null; saved: boolean };
export const ACCOUNT_FORM_INITIAL: AccountFormState = { error: null, saved: false };

export type AccountCommandState = { error: string | null; done: boolean };
export const ACCOUNT_COMMAND_INITIAL: AccountCommandState = { error: null, done: false };

/** What a reconciliation found, in the two shapes a person acts on. Never a credential. */
export type ReconcileState = {
  error: string | null;
  checkedAt: string | null;
  counts: Record<string, number>;
  /** Attention items only: a scope GOLD expects and the provider lacks, or the reverse. */
  findings: { organizationId: string; health: string; detail: string | null }[];
  unmanaged: { sid: string; friendlyName: string | null; status: string | null }[];
};
export const RECONCILE_INITIAL: ReconcileState = { error: null, checkedAt: null, counts: {}, findings: [], unmanaged: [] };
