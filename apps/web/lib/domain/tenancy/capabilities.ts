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
  'resource.create',
  'work_item.create',
  'asset.create',
  'document.create',
  'work_item.transition',
  'work_item.schedule',
  'work_item.record',
  'organization.manage',
  'price.manage',
  'work_item.price',
  'work_item.update',
  'invoice.issue',
  'payment.record',
  'automation.manage',
  'configuration.propose',
  'assistant.ask',
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
  'resource.create': 'Add resources',
  'work_item.create': 'Add work items',
  'asset.create': 'Add assets',
  'document.create': 'Attach documents',
  'work_item.transition': 'Move work along its board',
  'work_item.schedule': 'Assign and schedule work',
  'work_item.record': 'Record time and cost',
  'organization.manage': 'Change this business’s own settings',
  'price.manage': 'Set what this business charges',
  'work_item.price': 'Put priced items on a job',
  'work_item.update': 'Correct a job’s details',
  // Two rather than one, because they are plausibly two people. Deciding a job is finished
  // and asking to be paid for it is whoever runs the work; writing down that money arrived is
  // whoever opens the post.
  'invoice.issue': 'Invoice a finished job',
  'payment.record': 'Record a payment against an invoice',
  // Its own authority rather than part of managing the business, because it is the one thing a
  // role can hold that acts when nobody is present. Reading a rule needs nothing: an operator
  // who cannot write them still has to be able to find out why a job moved on its own.
  'automation.manage': 'Write the rules this business runs on its own',
  // Asking for a proposal, not applying one. Applying is whatever the proposal contains, and
  // each part of it is already gated by the capability that part needs — somebody who may not
  // create a role cannot apply a proposal that creates one, and the refusal comes from the
  // policy on `roles` rather than from anything on this list (D32).
  'configuration.propose': 'Ask the platform to draft this business’s setup',
  // Its own authority, and not because a question is dangerous — a tool reads nothing its
  // caller could not already read. It is because asking spends this deployment's money and
  // sends this business's rows to whoever answers, and both are decisions somebody takes on
  // purpose rather than inherit.
  'assistant.ask': 'Ask the platform questions about this business',
};
