/**
 * What a role may do — platform vocabulary, not tenant configuration. Adding one means writing
 * the code, the policy, and a migration extending `roles_capabilities_known`. Which role holds
 * which capability, and what that role is called, are tenant rows (D6).
 */
export const CAPABILITIES = [
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

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Describes what the platform does, not tenant terminology — that's a separate, later concern. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'marketing.read': 'View campaigns, audiences and acquisition results',
  'marketing.manage': 'Manage campaigns and audiences and review acquisition inquiries',
  'customer.create': 'Add customers',
  'opportunity.create': 'Add opportunities',
  'opportunity.update': 'Edit opportunities and move their stages',
  'follow_up.manage': 'Create, edit, complete and cancel CRM follow-ups',
  /** Separate from creating one — correcting a record and moving a relationship along its stages are plausibly two different people. */
  'customer.update': 'Correct a customer and move them along',
  'role.manage': 'Manage roles',
  'field.manage': 'Define custom fields',
  'location.create': 'Add locations',
  'resource.create': 'Add resources',
  /** Correcting a resource past its name — today, only which member it represents (Slice 0B). Split from `resource.create` the same way `customer.update` is split from `customer.create`. */
  'resource.update': 'Correct a resource, including which member it represents',
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
  /** Split from recording payment — deciding a job is finished is whoever runs the work; writing down that money arrived is whoever opens the post. */
  'invoice.issue': 'Invoice a finished job',
  'payment.record': 'Record a payment against an invoice',
  /** Its own authority — the one capability a role can hold that acts when nobody is present. */
  'automation.manage': 'Write the rules this business runs on its own',
  /** Asking for a proposal, not applying one — applying is gated per-part by whatever capability that part needs (D32). */
  'configuration.propose': 'Ask the platform to draft this business’s setup',
  /** Its own authority because asking spends this deployment's money and shares this business's rows with whoever answers — not because a question is dangerous. */
  'assistant.ask': 'Ask the platform questions about this business',
  /** Totals, not the rows behind them — anybody may open one invoice; this grants seeing a year of them added up. */
  'report.read': 'See what this business has billed and what its work cost',
  /** Authoring, not reading — saving a report others will see is closer to managing roles. */
  'report.manage': 'Save reports and choose which roles see them',
  /** Its own authority for the same reason as `assistant.ask` — placing a call spends money and shares this business's number. */
  'call.place': 'Call a customer and record how it went',
  /** Its own authority for the same reason as `call.place` — a receptionist may message without ever placing a call, and the reverse. */
  'message.send': 'Send a text or an email message and see the conversation',
  /** Connecting a source and applying what it imports are split from `customer.create`/`customer.update` on purpose — an import run still checks those per row, so this alone cannot write a customer. */
  'integration.manage': 'Connect external data sources and run imports',
  /** Deactivating or reactivating an entitled feature, not entitlement itself — a tenant cannot self-entitle. */
  'feature.manage': 'Switch entitled features on or off for this business',
  /** GOLD → organization money (domain-model.md's own plane), never the Commerce capabilities this business collects from its own customers with. */
  'billing.manage': 'Start or manage this business’s own subscription with GildOps',
  /** Its own authority, not part of `integration.manage`: connecting a spreadsheet and handing over a private key are different decisions, and a stored value is never read back by anyone who holds this. */
  'secret.manage': 'Add, replace and remove the private credentials this business gives GildOps to use',
};
