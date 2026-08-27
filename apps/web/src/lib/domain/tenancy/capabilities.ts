/**
 * What a role may do.
 *
 * This list is **platform vocabulary, not tenant configuration**. Each entry names an
 * operation the code actually performs and RLS actually checks, so adding one means writing
 * the code, the policy, and a migration extending `roles_capabilities_known`. A capability
 * that exists here but nowhere else is a promise the UI makes and the system does not keep.
 *
 * What is tenant configuration is which role holds which of these, and what that role is
 * called — those are rows in `roles` (D6).
 *
 * Grows one entry per slice that adds a guarded operation. It is deliberately short.
 */
export const CAPABILITIES = [
  'customer.create',
  'role.manage',
  'field.manage',
  'location.create',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Everything, granted to the role that founds an organization. */
export const ALL_CAPABILITIES: Capability[] = [...CAPABILITIES];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Human wording for each capability, for the one screen that has to render them.
 *
 * Not tenant-configurable: these describe what the *platform* does, not what a business
 * calls its own concepts. Per-tenant terminology is a separate, later concern
 * (`constraints.md`, "Decided, not yet built").
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'customer.create': 'Add customers',
  'role.manage': 'Manage roles',
  'field.manage': 'Define custom fields',
  'location.create': 'Add locations',
};
