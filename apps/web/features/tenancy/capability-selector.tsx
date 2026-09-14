import { CAPABILITIES, CAPABILITY_LABELS, type Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The one grouping of `CAPABILITIES` for a human reading a checkbox list — not a second
 * vocabulary, just an arrangement of the platform one. A capability added to `capabilities.ts`
 * with no entry here fails `capability-selector.test.ts`, the same way an area with no module
 * fails `navigation.test.ts`.
 */
const GROUPS: readonly { label: string; capabilities: readonly Capability[] }[] = [
  { label: 'Customers', capabilities: ['customer.create', 'customer.update'] },
  {
    label: 'Work',
    capabilities: [
      'work_item.create',
      'work_item.update',
      'work_item.transition',
      'work_item.schedule',
      'work_item.record',
      'work_item.price',
    ],
  },
  {
    label: 'Locations / assets / resources',
    capabilities: ['location.create', 'asset.create', 'resource.create'],
  },
  { label: 'Communications', capabilities: ['call.place'] },
  { label: 'Finance', capabilities: ['price.manage', 'invoice.issue', 'payment.record'] },
  {
    label: 'Automation & AI',
    capabilities: ['automation.manage', 'assistant.ask', 'configuration.propose'],
  },
  { label: 'Reporting', capabilities: ['report.read', 'report.manage'] },
  { label: 'Documents / data', capabilities: ['document.create', 'field.manage'] },
  { label: 'People & access', capabilities: ['role.manage'] },
  {
    label: 'Business administration',
    capabilities: ['organization.manage', 'integration.manage', 'feature.manage'],
  },
];

/** Every capability named exactly once, in `CAPABILITIES` order within its group — asserted by `capability-selector.test.ts`. */
export const CAPABILITY_GROUPS = GROUPS;

/**
 * A grouped checkbox list for one role's capabilities — one named component, used by both
 * `CreateRoleForm` and `EditRoleSheet` rather than a schema-driven form engine built for a
 * single purpose (the brief's own warning against that).
 */
export function CapabilitySelector({
  selected,
  idPrefix = 'capability',
}: {
  /** Which capabilities start checked — empty for a new role, the role's own set when editing. */
  selected?: ReadonlySet<Capability>;
  idPrefix?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-subtle">{group.label}</legend>
          {group.capabilities.map((capability) => {
            const id = `${idPrefix}-${capability}`;
            return (
              <label key={capability} htmlFor={id} className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  name="capabilities"
                  value={capability}
                  defaultChecked={selected?.has(capability) ?? false}
                />
                {CAPABILITY_LABELS[capability]}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

// Every capability appears in exactly one group — checked here rather than only by the test, so
// a build with a mistake in the table above fails loudly rather than shipping a checkbox that
// silently cannot be granted.
const grouped = new Set(GROUPS.flatMap((g) => g.capabilities));
for (const capability of CAPABILITIES) {
  if (!grouped.has(capability)) {
    throw new Error(`CapabilitySelector has no group for capability "${capability}".`);
  }
}
if (grouped.size !== CAPABILITIES.length) {
  throw new Error('CapabilitySelector groups a capability that capabilities.ts no longer declares.');
}
