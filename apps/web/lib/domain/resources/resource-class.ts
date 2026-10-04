/**
 * What kind of schedulable thing a resource is — platform vocabulary, a small closed set that means
 * the same to a clinic and a garage. **Not** the business's own words for what a resource can do:
 * those are capabilities (`resource-capabilities.ts`), and a mechanic is a person with some. Not an
 * Asset's type either — the customer's car is what work is about, the service van is what work is
 * done with.
 *
 * `other` exists for the genuine schedulable thing that fits none of the four, and for resources
 * that existed before a class could be stated. It is never what a new resource is quietly given.
 */
export const RESOURCE_CLASSES = ['person', 'vehicle', 'equipment', 'facility', 'other'] as const;

export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

export const RESOURCE_CLASS_LABELS: Record<ResourceClass, string> = {
  person: 'Person',
  vehicle: 'Vehicle',
  equipment: 'Equipment',
  facility: 'Facility',
  other: 'Other',
};

export function isResourceClass(value: unknown): value is ResourceClass {
  return typeof value === 'string' && (RESOURCE_CLASSES as readonly string[]).includes(value);
}
