/**
 * What a role may do — platform vocabulary, not tenant configuration. Adding one means writing
 * the code, the policy, and a migration extending `roles_capabilities_known`. Which role holds
 * which capability, and what that role is called, are tenant rows.
 */
export const CAPABILITIES = [
  'support.read',
  'support.case.create',
  'support.case.update',
  'support.case.assign',
  'support.case.resolve',
  'support.configure',
  'marketing.read',
  'marketing.manage',
  'customer.create',
  'customer.update',
  'opportunity.create',
  'opportunity.update',
  'follow_up.manage',
  'role.manage',
  'field.manage',
  'location.create',
  'resource.create',
  'resource.update',
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
  'report.read',
  'report.manage',
  'call.place',
  'message.send',
  'integration.manage',
  'feature.manage',
  'billing.manage',
  'secret.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Everything, granted to the role that founds an organization. */
export const ALL_CAPABILITIES: Capability[] = [...CAPABILITIES];

/**
 * Permissions that reach beyond a person's own work: who may do what, the business's own settings
 * and connections, money owed to GildOps, stored credentials, and rules that act with nobody
 * present. The role editor marks them; nothing is enforced differently because of this list.
 */
export const SENSITIVE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'role.manage',
  'organization.manage',
  'integration.manage',
  'billing.manage',
  'secret.manage',
  'automation.manage',
]);

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Describes what the platform does, not tenant terminology — that's a separate, later concern. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'support.read': 'View Support Cases, private history and reports',
  'support.case.create': 'Create Support Cases',
  'support.case.update': 'Edit and escalate Cases and add internal notes',
  'support.case.assign': 'Assign Support Cases and queues',
  'support.case.resolve': 'Resolve, close and explicitly reopen Support Cases',
  'support.configure': 'Set up Support queues and service levels',
  'marketing.read': 'View campaigns, audiences and acquisition results',
  'marketing.manage': 'Manage campaigns and audiences and review acquisition inquiries',
  'customer.create': 'Add contacts',
  'opportunity.create': 'Add opportunities',
  'opportunity.update': 'Edit opportunities and move their stages',
  'follow_up.manage': 'Create, edit, complete and cancel CRM tasks',
  /** Separate from creating one — correcting a record and moving a relationship along its stages are plausibly two different people. */
  'customer.update': 'Edit contacts and move them between relationship stages',
  'role.manage': 'Manage members, invitations and roles',
  'field.manage': 'Define custom fields',
  'location.create': 'Add locations',
  'resource.create': 'Add resources',
  /** Correcting a resource past its name — today, only which member it represents (Slice 0B). Split from `resource.create` the same way `customer.update` is split from `customer.create`. */
  'resource.update': 'Edit resources, including which member each one represents',
  'work_item.create': 'Add work items',
  'asset.create': 'Add assets',
  'document.create': 'Attach documents',
  'work_item.transition': 'Move work between stages',
  'work_item.schedule': 'Assign and schedule work',
  'work_item.record': 'Record time and cost',
  'organization.manage': 'Change business settings',
  'price.manage': 'Set what this business charges',
  'work_item.price': 'Add priced items to work',
  'work_item.update': 'Edit work details',
  /** Split from recording payment — deciding a job is finished is whoever runs the work; writing down that money arrived is whoever opens the post. */
  'invoice.issue': 'Issue invoices, from Work or directly to a customer',
  'payment.record': 'Record a payment against an invoice',
  /** Its own authority — the one capability a role can hold that acts when nobody is present. */
  'automation.manage': 'Create and edit automation rules',
  /** Asking for a proposal, not applying one — applying is gated per-part by whatever capability that part needs. */
  'configuration.propose': 'Ask GildOps to draft this business’s setup',
  /** Its own authority because asking spends this deployment's money and shares this business's rows with whoever answers — not because a question is dangerous. */
  'assistant.ask': 'Ask the assistant questions about this business',
  /** Totals, not the rows behind them — anybody may open one invoice; this grants seeing a year of them added up. */
  'report.read': 'See what this business has billed and what its work cost',
  /** Authoring, not reading — saving a report others will see is closer to managing roles. */
  'report.manage': 'Save reports and choose which roles see them',
  /** Its own authority for the same reason as `assistant.ask` — placing a call spends money and shares this business's number. */
  'call.place': 'Place calls and record their outcome',
  /** Its own authority for the same reason as `call.place` — a receptionist may message without ever placing a call, and the reverse. */
  'message.send': 'Send texts and emails and see conversations',
  /** Connecting a source and applying what it imports are split from `customer.create`/`customer.update` on purpose — an import run still checks those per row, so this alone cannot write a customer. */
  'integration.manage': 'Connect external data sources and run imports',
  /** Deactivating or reactivating an entitled feature, not entitlement itself — a tenant cannot self-entitle. */
  'feature.manage': 'Switch features in your plan on or off for this business',
  /** GOLD → organization money (domain-model.md's own plane), never the Commerce capabilities this business collects from its own customers with. */
  'billing.manage': 'Start or manage this business’s own subscription with GildOps',
  /** Its own authority, not part of `integration.manage`: connecting a spreadsheet and handing over a private key are different decisions, and a stored value is never read back by anyone who holds this. */
  'secret.manage': 'Add, replace and remove the private credentials this business gives GildOps to use',
};
